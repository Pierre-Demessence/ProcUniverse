import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { SystemData } from './generation/universe';
import type { Tier } from './lod/tier';
import type { Save } from './persistence/save';
import type { Selection } from './pick';
import type { ThreeRenderer } from './render/three/three-renderer';
import type { NavNode, NavState, NavSystem } from './ui/nav-tree';

import { EcsWorld } from '@pierre/ecs';
import { worldToView } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { frameZoom } from './camera/focus';
import { cameraAbsolute, rebaseLocal } from './camera/origin';
import { CLICK_SLOP_PX, DISC_FRAME_FACTOR, FRAME_MARGIN, GALAXY_SPRITE_SCALE, MAX_ZOOM, MIN_ZOOM, REBASE_SECTORS, STATS_HUD_GAP_PX, STATS_HUD_RIGHT_RESERVE_PX, STATS_HUD_TOP_PX, STATS_HUD_WIDTH_PX, SYSTEM_VIEW_AU, TIER_FADE_MS } from './config/render';
import { BlackHoleDef, galaxyAt } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { SECONDS_PER_YEAR } from './generation/units';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import { selectTier, visibleSectors } from './lod/tier';
import { writeSave } from './persistence/save';
import { findEntityByName, pickBodyAt, pickGalaxyAt } from './pick';
import { drawCoords } from './render/draw-coords';
import { drawScaleBar } from './render/scale-bar';
import { renderFrame } from './render/scene';
import { drawSelectReticle } from './render/select-reticle';
import { blackHoleVisualRadius, planetVisualRadius, SECTOR_SIZE, starVisualRadius } from './scale';
import { renderBackend } from './settings';
import { OrbitElementsDef, updateOrbits, writeOrbitPosition } from './sim/orbits';
import { createInspector } from './ui/inspector';
import { createNavTree } from './ui/nav-tree';
import { createOptionsMenu } from './ui/options';
import { createResetViewButton } from './ui/reset-view';
import { createTimeControls } from './ui/time-controls';

const TARGET_MS = 1000 / 60;
const REBASE_DIST = SECTOR_SIZE * REBASE_SECTORS;
const HINT = 'Drag to pan  ·  Scroll to zoom';

/**
 * App entry. Wires the ECS world, the LOD tier system (sector streaming at the
 * system tier; immediate-mode star dots and galaxy-density glows when zoomed
 * out), the camera, and the rAF render loop.
 */
export function start(container: HTMLElement, save: Save): () => void {
  container.innerHTML = '';
  const { seed } = save;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
  container.append(canvas);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d)
    throw new Error('ProcUniverse: 2D canvas context is unavailable.');

  // Offscreen snapshot used to cross-fade between LOD tiers.
  const fadeCanvas = document.createElement('canvas');
  const fadeCtx = fadeCanvas.getContext('2d');
  if (!fadeCtx)
    throw new Error('ProcUniverse: 2D canvas context is unavailable.');
  let fadeMsLeft = 0;

  // Offscreen copy of the last rendered scene (without HUD overlays).  On
  // clean frames we blit this back so the cheap overlay pass always draws on
  // a fresh copy of the scene without re-rendering the expensive content.
  const sceneCache = document.createElement('canvas');
  const sceneCacheCtx = sceneCache.getContext('2d');
  if (!sceneCacheCtx)
    throw new Error('ProcUniverse: 2D canvas context is unavailable.');
  let sceneCacheValid = false;

  // Three.js (WebGPU) renderer for the parallel rendering backend. Loaded and
  // created lazily the first time the backend is switched to Three (so Canvas 2D
  // sessions never download the three bundle), then kept for the session.
  let threeRenderer: ThreeRenderer | null = null;
  let threeLoading = false;

  // Size the backing store to device pixels before the camera is created, so it
  // reads real dimensions rather than the canvas default (300x150).
  const sizeCanvas = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    fadeCanvas.width = canvas.width;
    fadeCanvas.height = canvas.height;
    sceneCache.width = canvas.width;
    sceneCache.height = canvas.height;
    threeRenderer?.resize(canvas.width, canvas.height);
    fadeMsLeft = 0;
    sceneCacheValid = false;
  };
  sizeCanvas();

  const controller = createCameraController(canvas);
  const timeControls = createTimeControls(container, save.speedIndex);

  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(MoonPhysicalDef);
  world.registerComponent(NameDef);
  world.registerComponent(BlackHoleDef);

  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);

  // Deterministic universe: sectors are generated on demand and cached; the
  // streamer spawns/despawns full systems for the sectors in view at the system
  // tier.
  const cache = new SectorCache(seed);
  const streamer = new SystemStreamer(world, cache);

  const renderer = new Canvas2DRenderer();
  const frameStats = new FrameStats();

  // Keep the camera viewport equal to the canvas backing size so the renderer's
  // cull rect and the pointer math share a single coordinate space.
  const syncViewport = (): void => {
    sizeCanvas();
    controller.camera.viewportW = canvas.width;
    controller.camera.viewportH = canvas.height;
  };
  syncViewport();

  // The origin view frames the home galaxy's centre (its central black hole);
  // fall back to the first system or the sector centre if absent. Captured as a
  // reusable framing so startup and the "return to origin" button agree.
  const homeGalaxy = galaxyAt(seed, 0, 0);
  const originSector = cache.get(0, 0);
  const homeFocus = homeGalaxy
    ? { x: homeGalaxy.centerX, y: homeGalaxy.centerY }
    : originSector.systems.length > 0
      ? originSector.systems[0]
      : { x: SECTOR_SIZE / 2, y: SECTOR_SIZE / 2 };

  // Floating render origin. The camera position is stored as a SMALL OFFSET from
  // this origin (`camera.x/y`), not as an absolute coordinate, so pan/zoom deltas
  // never fall below the float64 ULP however far the camera travels; the absolute
  // position is `renderOrigin + camera.x`. The origin snaps to the focused star at
  // the system tier (for canvas disc precision) and to the sector grid otherwise,
  // rebased as the local offset grows.
  let renderOriginX = 0;
  let renderOriginY = 0;

  const frameOrigin = (): void => {
    renderOriginX = Math.round(homeFocus.x / SECTOR_SIZE) * SECTOR_SIZE;
    renderOriginY = Math.round(homeFocus.y / SECTOR_SIZE) * SECTOR_SIZE;
    controller.camera.x = homeFocus.x - renderOriginX;
    controller.camera.y = homeFocus.y - renderOriginY;
    controller.camera.zoom = canvas.height / SYSTEM_VIEW_AU;
  };

  // Resume the saved view from a previous visit, or frame the origin on a first
  // visit. The saved view is absolute; anchor the origin to it and store the
  // small offset. A persisted zoom is clamped in case the config bounds changed.
  const savedView = save.view;
  if (savedView) {
    renderOriginX = Math.round(savedView.x / SECTOR_SIZE) * SECTOR_SIZE;
    renderOriginY = Math.round(savedView.y / SECTOR_SIZE) * SECTOR_SIZE;
    controller.camera.x = savedView.x - renderOriginX;
    controller.camera.y = savedView.y - renderOriginY;
    controller.camera.zoom = clamp(savedView.zoom, MIN_ZOOM, MAX_ZOOM);
  }
  else {
    frameOrigin();
  }

  const resizeObserver = new ResizeObserver(syncViewport);
  resizeObserver.observe(container);

  // A container ResizeObserver does not fire when only devicePixelRatio changes
  // (e.g. dragging the window to a different-DPI monitor), which would leave the
  // canvas blurry. Re-sync on each DPR change and re-arm the watcher.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    syncViewport();
    watchDpr();
  };
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  }
  watchDpr();

  const { camera } = controller;
  let simSeconds = save.simSeconds;
  // Initialise to the restored view's tier (not a hardcoded 'system') so the
  // first frame doesn't register a spurious tier change and cross-fade from a
  // blank canvas when resuming zoomed out.
  let currentTier: Tier = selectTier(camera, 'system');

  // Body selection (system tier only). A pointer gesture is treated as a pick
  // only when it barely moved — a real drag pans the view and never selects.
  // Escape and empty-space clicks clear the selection; the render loop clears it
  // when the body streams out or the tier changes.
  let selection: Selection | null = null;
  let pointerDownX = 0;
  let pointerDownY = 0;
  // Armed when a pointerdown starts while locked — the first move beyond
  // CLICK_SLOP_PX releases the lock so the re-centre doesn't fight the pan.
  let lockDragArmed = false;

  const toBackingPx = (clientX: number, clientY: number): { bx: number; by: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      bx: (clientX - rect.left) * (canvas.width / rect.width),
      by: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  let lockedId: EntityId | null = null;

  const setSelection = (next: Selection | null): void => {
    selection = next;
    lockedId = null;
  };

  const toggleLock = (): void => {
    if (!selection || (selection.kind !== 'planet' && selection.kind !== 'moon'))
      return;
    lockedId = lockedId === selection.id ? null : selection.id;
  };

  const onZoomTo = (): void => {
    if (selection)
      frameSelection(selection, world, camera, renderOriginX, renderOriginY);
  };

  const inspector = createInspector(container, { onToggleLock: toggleLock, onZoomTo });

  const onPickDown = (e: PointerEvent): void => {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    lockDragArmed = lockedId !== null;
  };
  const onLockPointerMove = (e: PointerEvent): void => {
    if (!lockDragArmed || lockedId === null)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX) {
      lockedId = null;
      lockDragArmed = false;
    }
  };
  const onPickUp = (e: PointerEvent): void => {
    lockDragArmed = false;
    // Ignore releases over the HUD panels (tree / inspector / time): those are
    // their own clicks, not a canvas pick that should re-select or clear.
    if (e.target !== canvas)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX)
      return;
    const { bx, by } = toBackingPx(e.clientX, e.clientY);
    // `camera` is already in the render-origin frame, so it doubles as localCam.
    const localCam = { ...camera };
    if (currentTier === 'system') {
      setSelection(pickBodyAt(world, localCam, bx, by));
    }
    else if (currentTier === 'galaxy-field') {
      const galaxy = pickGalaxyAt(seed, localCam, renderOriginX, renderOriginY, bx, by);
      setSelection(galaxy ? { galaxy, kind: 'galaxy' } : null);
    }
  };
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape')
      setSelection(null);
  };
  canvas.addEventListener('pointerdown', onPickDown);
  window.addEventListener('pointermove', onLockPointerMove);
  window.addEventListener('pointerup', onPickUp);
  window.addEventListener('keydown', onPickKey);

  // Location tree (top-left): clicking a body node pins it in the inspector,
  // resolving the streamed entity by its unique catalogue name. Galaxy nodes
  // recompute the galaxy under the camera; the Universe node is not selectable.
  // Double-clicking any node also zooms the camera to frame it.
  const navTree = createNavTree(container, {
    onDoubleClick(node: NavNode): void {
      onZoomTo();
      if (node.kind === 'planet' || node.kind === 'moon') {
        // The first click already set selection to this body via onSelect.
        if (selection && selection.kind === node.kind)
          lockedId = selection.id;
      }
    },
    onSelect(node: NavNode): void {
      if (node.kind === 'universe') {
        setSelection({ kind: 'universe', seed });
      }
      else if (node.kind === 'galaxy') {
        const g = galaxyAt(seed, cameraAbsolute(renderOriginX, camera.x), cameraAbsolute(renderOriginY, camera.y));
        setSelection(g ? { galaxy: g, kind: 'galaxy' } : null);
      }
      else if (node.kind === 'star' || node.kind === 'planet' || node.kind === 'moon') {
        const id = findEntityByName(world, node.name);
        if (id !== null)
          setSelection({ id, kind: node.kind });
      }
    },
  });

  // Bottom-centre control to snap the camera back to the origin framing after
  // panning far across the universe.
  const onResetView = (): void => {
    lockedId = null;
    frameOrigin();
  };
  const resetViewButton = createResetViewButton(container, { onReset: onResetView });

  // Top-centre options menu for display preferences (units, etc.).
  const optionsMenu = createOptionsMenu(container);

  // Dirty-frame tracking: at non-system tiers nothing animates, so when the
  // camera is still the view is identical frame to frame.  Skip the heavy
  // render pass and just measure FPS.
  let lastCamX = camera.x;
  let lastCamY = camera.y;
  let lastCamZoom = camera.zoom;
  let lastVpW = camera.viewportW;
  let lastVpH = camera.viewportH;
  let lastSelection: Selection | null = null;
  let lastDrawnCount = 0;
  let lastThreeActive = false;

  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    simSeconds += (dt / 1000) * timeControls.timeScale;
    frameStats.sample(dt);

    // Lock: re-centre the camera on the locked body before anything else this
    // frame so the tier, origin, streaming, and render are all consistent with
    // the body at the centre of the view. Zoom is NOT changed — Lock never
    // zooms, only pins the body.
    if (lockedId !== null) {
      const p = lockedBodyLocalPos(world, lockedId, simSeconds);
      if (p) {
        camera.x = p.x;
        camera.y = p.y;
      }
      else {
        lockedId = null;
      }
    }

    const tier = selectTier(camera, currentTier);
    const tierChanged = tier !== currentTier;
    currentTier = tier;

    const camMoved = camera.x !== lastCamX || camera.y !== lastCamY || camera.zoom !== lastCamZoom;
    lastCamX = camera.x;
    lastCamY = camera.y;
    lastCamZoom = camera.zoom;
    const vpChanged = camera.viewportW !== lastVpW || camera.viewportH !== lastVpH;
    lastVpW = camera.viewportW;
    lastVpH = camera.viewportH;
    const selChanged = selection !== lastSelection;
    lastSelection = selection;

    // Rendering backend: lazily stand up the Three.js renderer the first time it
    // is selected, keep its canvas behind the 2D HUD canvas, and show it only
    // once it has finished initialising — until then the Canvas 2D path keeps
    // drawing, so switching never flashes a blank frame.
    const threeMode = renderBackend.value === 'three';
    if (threeMode && !threeRenderer && !threeLoading) {
      // Load the Three.js backend (and its large three bundle) on demand, so
      // Canvas 2D sessions never pay for it. Canvas 2D keeps drawing until the
      // module has loaded and the renderer has initialised.
      threeLoading = true;
      void import('./render/three/three-renderer').then(({ ThreeRenderer }) => {
        threeRenderer = new ThreeRenderer();
        threeRenderer.resize(canvas.width, canvas.height);
        container.insertBefore(threeRenderer.canvas, canvas);
      }).catch((error: unknown) => {
        // Allow a later retry if the chunk failed to load (e.g. transient network).
        threeLoading = false;
        console.error('ProcUniverse: failed to load the Three.js backend.', error);
      });
    }
    const threeActive = threeMode && threeRenderer !== null && threeRenderer.ready;
    if (threeRenderer)
      threeRenderer.canvas.style.display = threeActive ? 'block' : 'none';
    const backendChanged = threeActive !== lastThreeActive;
    lastThreeActive = threeActive;

    // A frame is dirty when there is no cached scene to blit (startup, or after
    // a resize / DPR change cleared the canvas and invalidated it), the system
    // tier animates, the tier cross-fades, the rendering backend changed, or the
    // camera, viewport, or selection changed. Without the cache-invalid check a
    // still camera at a non-system tier would leave the just-cleared canvas blank
    // until the next interaction.
    const dirty = !sceneCacheValid || tier === 'system' || tierChanged || camMoved || vpChanged || selChanged || fadeMsLeft > 0 || backendChanged;

    if (dirty) {
      // Absolute camera position, reconstructed only for sector indexing and the
      // origin decision (both tolerate the ~ULP reconstruction error); the precise
      // render path keeps using the small local `camera.x/y`.
      const camAbsX = cameraAbsolute(renderOriginX, camera.x);
      const camAbsY = cameraAbsolute(renderOriginY, camera.y);
      const range = visibleSectors({ ...camera, x: camAbsX, y: camAbsY });

      // Rebase the render origin so the renderer always draws on small, precise
      // local coordinates. At the system tier we rebase onto the focused star
      // itself, dropping planet coords to tens of AU: without this, discs drawn at
      // ~10^5 AU local coordinates lose canvas path precision and render as jagged
      // blobs. Zoomed out, snap to the sector grid and rebase only when the local
      // offset grows large. When the origin moves, shift `camera.x/y` by the same
      // amount so the absolute position is unchanged, and respawn the systems.
      let originX = renderOriginX;
      let originY = renderOriginY;
      if (tier === 'system') {
        const focus = nearestStar(cache, camAbsX, camAbsY);
        originX = focus ? focus.x : Math.round(camAbsX / SECTOR_SIZE) * SECTOR_SIZE;
        originY = focus ? focus.y : Math.round(camAbsY / SECTOR_SIZE) * SECTOR_SIZE;
      }
      else if (Math.abs(camera.x) > REBASE_DIST || Math.abs(camera.y) > REBASE_DIST) {
        originX = Math.round(camAbsX / SECTOR_SIZE) * SECTOR_SIZE;
        originY = Math.round(camAbsY / SECTOR_SIZE) * SECTOR_SIZE;
      }
      if (originX !== renderOriginX || originY !== renderOriginY) {
        camera.x = rebaseLocal(renderOriginX, camera.x, originX);
        camera.y = rebaseLocal(renderOriginY, camera.y, originY);
        renderOriginX = originX;
        renderOriginY = originY;
        streamer.clear();
      }

      // Stream full systems only at the system tier; otherwise despawn them.
      if (tier === 'system')
        streamer.update(range, renderOriginX, renderOriginY);
      else
        streamer.clear();
      // Flush despawns, drop the (subscriber-less) lifecycle events the
      // spawns/despawns queued, and clear the stores' dirty sets (nothing
      // consumes them) before anything reads the entity set.
      world.endOfTick();
      world.clearAllDirty();

      if (tier === 'system')
        updateOrbits(world, simSeconds);

      // Capture the previous frame to cross-fade out of on a tier change — but
      // only when the cache is valid, i.e. the canvas still holds a good prior
      // frame (not a blank startup canvas or one a resize just cleared).
      if (tierChanged && sceneCacheValid && !threeActive) {
        fadeCtx.clearRect(0, 0, fadeCanvas.width, fadeCanvas.height);
        fadeCtx.drawImage(canvas, 0, 0);
        fadeMsLeft = TIER_FADE_MS;
      }

      // `camera.x/y` are already the offset from the render origin, so the camera
      // doubles as the render-frame camera with no huge − huge subtraction. The
      // Lock re-centre at the top of the frame set `camera` to the body's local
      // position, so a locked body stays exactly centred.
      const localCam = { ...camera };
      const result = renderFrame({
        cache,
        camera: localCam,
        canvas,
        ctx2d,
        originX: renderOriginX,
        originY: renderOriginY,
        range,
        renderer,
        seed,
        threeMode: threeActive,
        tier,
        world,
      });

      // Draw the system-tier bodies with the Three.js renderer onto its own
      // canvas behind the transparent 2D canvas. `renderFrame` above has already
      // run `applyBodyScale`, so the bodies' RenderableDef radii are floored for
      // the current zoom before Three reads them. Only the system tier uses Three
      // in Stage 0; the other tiers stay on Canvas 2D.
      if (threeActive && tier === 'system' && threeRenderer)
        threeRenderer.render({ camera: localCam, world });

      // Cross-fade: blend the captured old-tier frame over the new one.
      if (fadeMsLeft > 0) {
        ctx2d.save();
        ctx2d.globalAlpha = Math.min(1, fadeMsLeft / TIER_FADE_MS);
        ctx2d.drawImage(fadeCanvas, 0, 0);
        ctx2d.restore();
        fadeMsLeft -= dt;
      }

      // Track the selected body: clear it if it streamed out or the tier left the
      // system view, otherwise draw its reticle at the body's live screen position
      // (so it follows an orbiting planet) and refresh the data panel.
      if (selection) {
        if (selection.kind === 'galaxy') {
          // A galaxy selection persists across tiers (it may be pinned from the
          // location tree while zoomed in); only its on-canvas reticle is gated
          // to the galaxy-field tier where galaxies are discrete sprites.
          if (tier === 'galaxy-field') {
            const screen = worldToView(selection.galaxy.centerX - renderOriginX, selection.galaxy.centerY - renderOriginY, localCam);
            drawSelectReticle(ctx2d, screen.vx, screen.vy, selection.galaxy.radius * GALAXY_SPRITE_SCALE * camera.zoom);
          }
        }
        else if (selection.kind !== 'universe') {
          const pos = tier === 'system' ? positions.get(selection.id) : undefined;
          if (!pos) {
            setSelection(null);
          }
          else {
            const renderable = renderables.get(selection.id);
            const discRadius = renderable?.kind === 'circle' ? renderable.radius : 0;
            const screen = worldToView(pos.x, pos.y, localCam);
            drawSelectReticle(ctx2d, screen.vx, screen.vy, discRadius * camera.zoom);
          }
        }
      }

      const status = streamer.status();
      lastDrawnCount = result < 0 ? status.stars + status.planets : result;

      // Snapshot the fully-composed scene (background + content + reticle +
      // cross-fade, but NO overlays) so clean frames can blit it back and
      // only redraw the cheap HUD on top.
      sceneCacheCtx.clearRect(0, 0, sceneCache.width, sceneCache.height);
      sceneCacheCtx.drawImage(canvas, 0, 0);
      sceneCacheValid = true;
    }
    else if (sceneCacheValid) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(sceneCache, 0, 0);
    }

    // Lightweight HUD overlays and DOM updates — cheap enough to run every
    // frame so the time display and frame-time sparkline stay live.
    frameStats.setCounter('drawn', lastDrawnCount);
    inspector.update(world, selection, lockedId);
    // The tree and the coordinate readout want the ABSOLUTE camera position.
    const camAbs = { ...camera, x: cameraAbsolute(renderOriginX, camera.x), y: cameraAbsolute(renderOriginY, camera.y) };
    navTree.update(buildNavState(seed, cache, camAbs, tier, world, selection));
    // Perf monitor: top-right, just left of the sim-time panel (so the tree
    // owns the top-left). Knobs are CSS pixels; the overlay draws in backing
    // pixels, hence the dpr scale.
    const dpr = window.devicePixelRatio || 1;
    // The sim-panel reserve and top margin are CSS pixels (scaled by dpr to
    // track the DOM sim panel); the overlay's own width is intrinsic backing
    // pixels (it renders dpr-independently), so it is subtracted unscaled —
    // keeping the panel snug left of the sim panel at any device pixel ratio.
    const statsX = canvas.width - (STATS_HUD_RIGHT_RESERVE_PX + STATS_HUD_GAP_PX) * dpr - STATS_HUD_WIDTH_PX;
    drawStatsOverlay(ctx2d, frameStats, { targetMs: TARGET_MS, x: statsX, y: STATS_HUD_TOP_PX * dpr });
    drawHint(ctx2d, canvas, tier);
    drawScaleBar(ctx2d, camera);
    drawCoords(ctx2d, camAbs, seed);
    timeControls.update(simSeconds);
  });
  renderSource.start();

  return (): void => {
    // Persist the final session state (camera, clock, speed) so the next visit
    // resumes here; this teardown is wired to `beforeunload`.
    writeSave({ ...save, simSeconds, speedIndex: timeControls.speedIndex, view: { x: cameraAbsolute(renderOriginX, camera.x), y: cameraAbsolute(renderOriginY, camera.y), zoom: camera.zoom } });
    renderSource.stop();
    unsubscribe();
    resizeObserver.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    canvas.removeEventListener('pointerdown', onPickDown);
    window.removeEventListener('pointermove', onLockPointerMove);
    window.removeEventListener('pointerup', onPickUp);
    window.removeEventListener('keydown', onPickKey);
    controller.dispose();
    timeControls.dispose();
    inspector.dispose();
    navTree.dispose();
    resetViewButton.dispose();
    optionsMenu.dispose();
    threeRenderer?.dispose();
  };
}

/** The system nearest the camera within its sector, or null if the sector is empty. */
function nearestStar(cache: SectorCache, camX: number, camY: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  let best: SystemData | null = null;
  let bestDist = Infinity;
  for (const sys of cache.get(sx, sy).systems) {
    const dx = sys.x - camX;
    const dy = sys.y - camY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = sys;
    }
  }
  return best;
}

/** Assemble the location tree's state from the camera and current tier. */
function buildNavState(seed: number, cache: SectorCache, camera: Camera, tier: Tier, world: EcsWorld, selection: Selection | null): NavState {
  const galaxy = galaxyAt(seed, camera.x, camera.y);
  let system: NavSystem | null = null;
  if (tier === 'system') {
    const focus = nearestStar(cache, camera.x, camera.y);
    if (focus)
      system = { name: focus.name.scientific, humanName: focus.name.human, planets: focus.planets.map(p => ({ name: p.name.scientific, humanName: p.name.human, moons: p.moons.map(m => ({ name: m.name.scientific, humanName: m.name.human })) })) };
  }
  return {
    galaxy: galaxy ? { name: galaxy.name, humanName: galaxy.humanName } : null,
    selectedKey: selectionKey(world, selection),
    system,
    tier,
  };
}

/** The tree-node `key` matching the current selection, for highlighting. */
function selectionKey(world: EcsWorld, selection: Selection | null): string | null {
  if (!selection)
    return null;
  if (selection.kind === 'universe')
    return 'universe';
  if (selection.kind === 'galaxy')
    return `galaxy:${selection.galaxy.name}`;
  return world.getStore(NameDef).get(selection.id)?.scientific ?? null;
}

function drawHint(ctx2d: CanvasRenderingContext2D, canvas: HTMLCanvasElement, tier: Tier): void {
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = 'rgba(160, 190, 240, 0.55)';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(`${HINT}   ·   tier: ${tier}`, 10, canvas.height - 8);
  ctx2d.restore();
}

// ── Camera focus & lock helpers ───────────────────────────────────────────

/** The largest apoapsis among planets directly orbiting a given star. */
function starSatelliteApoapsis(world: EcsWorld, starPosX: number, starPosY: number): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent < 0 && Math.hypot(orbit.cx - starPosX, orbit.cy - starPosY) < 1e-6)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/** The largest apoapsis among moons orbiting a given planet. */
function planetSatelliteApoapsis(world: EcsWorld, planetId: EntityId): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent === planetId)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/**
 * Pan + zoom the camera to frame the selected body together with whatever
 * orbits it. The extent is the larger of the outermost satellite apoapsis and
 * `DISC_FRAME_FACTOR × disc radius`, so a satellite-less body still gets a
 * comfortable framing rather than filling the screen.
 */
function frameSelection(
  sel: Selection,
  world: EcsWorld,
  camera: Camera,
  renderOriginX: number,
  renderOriginY: number,
): void {
  if (sel.kind === 'universe')
    return;

  let cx: number;
  let cy: number;
  let extentAu: number;

  if (sel.kind === 'galaxy') {
    cx = sel.galaxy.centerX - renderOriginX;
    cy = sel.galaxy.centerY - renderOriginY;
    extentAu = sel.galaxy.radius * GALAXY_SPRITE_SCALE;
  }
  else {
    const pos = world.getStore(PositionDef).get(sel.id);
    if (!pos)
      return;
    cx = pos.x;
    cy = pos.y;

    let discRadiusAu: number;
    let satelliteExtent = 0;

    if (sel.kind === 'star') {
      const star = world.getStore(StarPhysicalDef).get(sel.id);
      if (!star)
        return;
      discRadiusAu = starVisualRadius(star.radius);
      satelliteExtent = starSatelliteApoapsis(world, pos.x, pos.y);
    }
    else if (sel.kind === 'planet') {
      const planet = world.getStore(PlanetPhysicalDef).get(sel.id);
      if (!planet)
        return;
      discRadiusAu = planetVisualRadius(planet.radius);
      satelliteExtent = planetSatelliteApoapsis(world, sel.id);
    }
    else if (sel.kind === 'moon') {
      const moon = world.getStore(MoonPhysicalDef).get(sel.id);
      if (!moon)
        return;
      discRadiusAu = planetVisualRadius(moon.radius);
    }
    else {
      const bh = world.getStore(BlackHoleDef).get(sel.id);
      if (!bh)
        return;
      discRadiusAu = blackHoleVisualRadius(bh.mass);
    }

    extentAu = Math.max(satelliteExtent, discRadiusAu * DISC_FRAME_FACTOR);
  }

  camera.zoom = frameZoom(extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
  camera.x = cx;
  camera.y = cy;
}

/**
 * Re-derive a body's position in the render-origin frame from the pure orbit
 * solver so Lock stays glued at any time scale (no one-frame lag) and without
 * round-tripping through absolute coordinates. Returns null when the entity or
 * its parent orbit has streamed out.
 */
function lockedBodyLocalPos(
  world: EcsWorld,
  id: EntityId,
  simSeconds: number,
): { x: number; y: number } | null {
  const orbit = world.getStore(OrbitElementsDef).get(id);
  if (!orbit)
    return null;
  const years = simSeconds / SECONDS_PER_YEAR;
  const tmp = { x: 0, y: 0 };
  if (orbit.parent < 0) {
    writeOrbitPosition(orbit, years, tmp);
  }
  else {
    const parentOrbit = world.getStore(OrbitElementsDef).get(orbit.parent);
    if (!parentOrbit)
      return null;
    const planetPos = { x: 0, y: 0 };
    writeOrbitPosition(parentOrbit, years, planetPos);
    writeOrbitPosition({ ...orbit, cx: planetPos.x, cy: planetPos.y }, years, tmp);
  }
  return { x: tmp.x, y: tmp.y };
}
