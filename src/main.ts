import type { Bookmark } from './bookmarks';
import type { Tier } from './lod/tier';
import type { Save } from './persistence/save';
import type { Selection } from './pick';
import type { ThreeRenderer } from './render/three/three-renderer';
import type { NavNode } from './ui/nav-tree';

import { EcsWorld } from '@pierre/ecs';
import { worldToView } from '@pierre/ecs/modules/camera';
import { projectPointer } from '@pierre/ecs/modules/input';
import { clamp } from '@pierre/ecs/modules/math';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { bookmarkKey, removeBookmark, selectionBookmarkKey, toggleBookmark } from './bookmarks';
import { createCameraController } from './camera/camera-controller';
import { frameZoom } from './camera/focus';
import { frameSelection } from './camera/framing';
import { cameraAbsolute, rebaseLocal } from './camera/origin';
import { CLICK_SLOP_PX, FRAME_MARGIN, GALAXY_SPRITE_SCALE, MAX_ZOOM, MIN_ZOOM, REBASE_SECTORS, STATS_HUD_GAP_PX, STATS_HUD_RIGHT_RESERVE_PX, STATS_HUD_TOP_PX, STATS_HUD_WIDTH_PX, SYSTEM_VIEW_AU, TIER_FADE_MS } from './config/render';
import { galaxyAt } from './generation/galaxies';
import { nearestSystem } from './lod/nearest-system';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import { selectTier, visibleSectors } from './lod/tier';
import { writeSave } from './persistence/save';
import { findEntityByName, pickBodyAt, pickGalaxyAt } from './pick';
import { drawCoords } from './render/draw-coords';
import { drawBodyLabels3D } from './render/draw-labels';
import { drawScaleBar } from './render/scale-bar';
import { renderFrame } from './render/scene';
import { drawSelectReticle } from './render/select-reticle';
import { ThreeBackend } from './render/three-backend';
import { SECTOR_SIZE } from './scale';
import { SelectionState } from './selection-state';
import { renderBackend } from './settings';
import { PositionZDef, updateOrbits } from './sim/orbits';
import { createBookmarkList } from './ui/bookmark-list';
import { createFlattenButton } from './ui/flatten-button';
import { createInspector } from './ui/inspector';
import { buildNavState } from './ui/nav-state';
import { createNavTree } from './ui/nav-tree';
import { createOptionsMenu } from './ui/options';
import { createResetViewButton } from './ui/reset-view';
import { createTimeControls } from './ui/time-controls';
import { universePlugin } from './world-plugin';

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
  const bookmarks: Bookmark[] = [...save.bookmarks];
  const persistBookmarks = (): void => {
    save.bookmarks = bookmarks;
    writeSave(save);
  };

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

  // Three.js renderer: loaded on first use (so Canvas 2D sessions never download
  // the three bundle) and mounted behind the transparent 2D HUD canvas.
  const threeBackend = new ThreeBackend<ThreeRenderer>(
    () => import('./render/three/three-renderer').then(({ ThreeRenderer }) => {
      const r = new ThreeRenderer();
      r.resize(canvas.width, canvas.height);
      return r;
    }),
    (r) => {
      container.insertBefore(r.canvas, canvas);
    },
  );

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
    threeBackend.resize(canvas.width, canvas.height);
    fadeMsLeft = 0;
    sceneCacheValid = false;
  };
  sizeCanvas();

  const controller = createCameraController(canvas);
  const timeControls = createTimeControls(container, save.speedIndex);

  const world = new EcsWorld().use(universePlugin);

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
  // The 3D orbit state (azimuth, tilt, focusZ) is also restored so the camera
  // direction and focus height survive a reload.
  const savedView = save.view;
  if (savedView) {
    renderOriginX = Math.round(savedView.x / SECTOR_SIZE) * SECTOR_SIZE;
    renderOriginY = Math.round(savedView.y / SECTOR_SIZE) * SECTOR_SIZE;
    controller.camera.x = savedView.x - renderOriginX;
    controller.camera.y = savedView.y - renderOriginY;
    controller.camera.zoom = clamp(savedView.zoom, MIN_ZOOM, MAX_ZOOM);
    controller.restoreOrbit(savedView.azimuth, savedView.tilt, savedView.focusZ);
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
  const selectionState = new SelectionState();
  let pointerDownX = 0;
  let pointerDownY = 0;
  // Armed when a pointerdown starts while locked — the first move beyond
  // CLICK_SLOP_PX releases the lock so the re-centre doesn't fight the pan.
  let lockDragArmed = false;

  // The 3D camera's look-at height (z) lives in the controller
  // (`controller.focusZ`): the 3D pan moves it, locking sets it to the body's
  // out-of-plane z, and Return-to-origin resets it. It is retained on unlock so
  // the view never snaps back to the ground plane and loses the body.

  const onZoomTo = (): void => {
    const selection = selectionState.selection;
    if (!selection)
      return;
    frameSelection(selection, world, camera, renderOriginX, renderOriginY);
    // Pin a planet / moon so it stays centred — in x, y and out-of-plane z — as
    // it orbits; static bodies (star / galaxy / black hole) need no lock. The
    // per-frame lock re-centre also supplies the 3D camera's focus height, so a
    // tilted view frames the body itself rather than its z=0 projection.
    selectionState.lockSelectedOrbiter();
  };

  const onToggleBookmark = (): void => {
    const selection = selectionState.selection;
    if (selection && toggleBookmark(bookmarks, selection, world, renderOriginX, renderOriginY))
      persistBookmarks();
  };

  const inspector = createInspector(container, { onToggleBookmark, onZoomTo, onToggleLock: () => selectionState.toggleLock() });

  const onPickDown = (e: PointerEvent): void => {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    // Only a left-button (pan) drag breaks a lock; right-drag orbits around it.
    lockDragArmed = selectionState.lockedId !== null && e.button === 0;
  };
  const onLockPointerMove = (e: PointerEvent): void => {
    if (!lockDragArmed || selectionState.lockedId === null)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX) {
      selectionState.unlock();
      lockDragArmed = false;
    }
  };
  const onPickUp = (e: PointerEvent): void => {
    lockDragArmed = false;
    // Only a left-button release is a pick; right-drag orbits the 3D view.
    if (e.button !== 0)
      return;
    // Ignore releases over the HUD panels (tree / inspector / time): those are
    // their own clicks, not a canvas pick that should re-select or clear.
    if (e.target !== canvas)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX)
      return;
    const { x: bx, y: by } = projectPointer(e, canvas);
    // `camera` is already in the render-origin frame, so it doubles as localCam.
    const localCam = { ...camera };
    if (currentTier === 'system') {
      const three = threeBackend.renderer;
      if (threeBackend.active && three)
        selectionState.select(three.pickAt(bx, by));
      else
        selectionState.select(pickBodyAt(world, localCam, bx, by));
    }
    else if (currentTier === 'galaxy-field') {
      const galaxy = pickGalaxyAt(seed, localCam, renderOriginX, renderOriginY, bx, by);
      selectionState.select(galaxy ? { galaxy, kind: 'galaxy' } : null);
    }
  };
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape')
      selectionState.select(null);
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
    onDoubleClick(): void {
      onZoomTo();
    },
    onSelect(node: NavNode): void {
      if (node.kind === 'universe') {
        selectionState.select({ kind: 'universe', seed });
      }
      else if (node.kind === 'galaxy') {
        const g = galaxyAt(seed, cameraAbsolute(renderOriginX, camera.x), cameraAbsolute(renderOriginY, camera.y));
        selectionState.select(g ? { galaxy: g, kind: 'galaxy' } : null);
      }
      else if (node.kind === 'star' || node.kind === 'planet' || node.kind === 'moon') {
        const id = findEntityByName(world, node.name);
        if (id !== null)
          selectionState.select({ id, kind: node.kind });
      }
    },
  });

  // Bottom-centre control to snap the camera back to the origin framing after
  // panning far across the universe.
  const onResetView = (): void => {
    selectionState.unlock();
    selectionState.cancelPending();
    controller.resetOrbit();
    frameOrigin();
  };
  const resetViewButton = createResetViewButton(container, { onReset: onResetView });

  // Contextual flatten toggle: only shown inside a system in the 3D renderer,
  // where snapping the tilted orbit view straight down the disk is meaningful.
  const flattenButton = createFlattenButton(container, { onToggle: isFlat => controller.setFlat(isFlat) });

  // Top-centre options menu for display preferences (units, etc.).
  const optionsMenu = createOptionsMenu(container);

  // Inspect a bookmarked body: zoom to its system (so it streams in if needed)
  // and open the inspector. For orbiting bodies (planets, moons) the bookmarked
  // position is stale, so the camera re-centres on the live position once the
  // entity is streamed (immediately, or via the pending resolution).
  const onBookmarkInspect = (bm: Bookmark): void => {
    camera.x = bm.x - renderOriginX;
    camera.y = bm.y - renderOriginY;
    camera.zoom = frameZoom(bm.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
    const id = selectionState.openBookmark(bm, world, seed);
    const pos = id === null ? undefined : positions.get(id);
    if (pos) {
      camera.x = pos.x;
      camera.y = pos.y;
    }
  };

  const onBookmarkRemove = (bm: Bookmark): void => {
    if (removeBookmark(bookmarks, bm))
      persistBookmarks();
  };

  const bookmarkList = createBookmarkList(container, {
    onInspect: onBookmarkInspect,
    onRemove: onBookmarkRemove,
  });

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
  let lastFlattenVisible = false;
  // Fallback orbital-plane normal (world +z) when no system is focused.
  const WORLD_PLANE_NORMAL = [0, 0, 1] as const;

  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    simSeconds += (dt / 1000) * timeControls.timeScale;
    frameStats.sample(dt);

    // Lock: re-centre the camera on the locked body before anything else this
    // frame so the tier, origin, streaming, and render are all consistent with
    // the body at the centre of the view. Zoom is NOT changed — Lock never
    // zooms, only pins the body. `controller.focusZ` carries the body's
    // out-of-plane height so the 3D camera looks at its true position, not its
    // z=0 projection; it is retained on unlock so the view doesn't jump.
    const lockedPos = selectionState.lockedPosition(world, simSeconds);
    if (lockedPos) {
      camera.x = lockedPos.x;
      camera.y = lockedPos.y;
      controller.setFocusZ(lockedPos.z);
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
    const selection = selectionState.selection;
    const selChanged = selection !== lastSelection;
    lastSelection = selection;

    // Rendering backend: Three shows its canvas only once ready; while it loads,
    // the 2D canvas stays transparent (threeMode) so there is no flash of Canvas
    // 2D content. If Three cannot load or initialise, Canvas 2D takes over every
    // tier for the rest of the session.
    const backend = threeBackend.update(renderBackend.value === 'three');
    const { threeMode } = backend;
    const threeActive = backend.active;
    const backendChanged = backend.changed;
    const threeRenderer = threeBackend.renderer;
    // Left-drag panning follows the tilted/orbited ground plane only in the 3D
    // perspective system view; every other tier keeps the raw 2D pan.
    controller.setThreeSystemActive(threeActive && tier === 'system');

    // The flatten toggle is only meaningful in the 3D system view; hide it
    // everywhere else (other tiers are already top-down 2D).
    const flattenVisible = threeActive && tier === 'system';
    if (flattenVisible !== lastFlattenVisible) {
      flattenButton.setVisible(flattenVisible);
      lastFlattenVisible = flattenVisible;
    }

    // Tracks whether Three actually drew this frame's tier: some tiers still fall
    // back to Canvas 2D even when the Three backend is selected, so the HUD shows
    // the renderer really in use.
    let renderedByThree = false;

    // A frame is dirty when there is no cached scene to blit (startup, or after
    // a resize / DPR change cleared the canvas and invalidated it), the system
    // tier animates, the tier cross-fades, the rendering backend changed, or the
    // camera, viewport, or selection changed. Without the cache-invalid check a
    // still camera at a non-system tier would leave the just-cleared canvas blank
    // until the next interaction.
    const dirty = !sceneCacheValid || tier === 'system' || tierChanged || camMoved || vpChanged || selChanged || fadeMsLeft > 0 || backendChanged || threeActive;

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
      // The system the camera is over (system tier only): its star anchors the
      // render origin and its disk normal anchors the 3D camera + pan.
      const focusedSystem = tier === 'system' ? nearestSystem(cache, camAbsX, camAbsY) : null;
      if (tier === 'system') {
        originX = focusedSystem ? focusedSystem.x : Math.round(camAbsX / SECTOR_SIZE) * SECTOR_SIZE;
        originY = focusedSystem ? focusedSystem.y : Math.round(camAbsY / SECTOR_SIZE) * SECTOR_SIZE;
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
      // Flush despawns and drop the (subscriber-less) lifecycle events the
      // spawns/despawns queued before anything reads the entity set.
      world.endOfTick();

      if (tier === 'system')
        updateOrbits(world, simSeconds);

      // Resolve a pending bookmark inspect before rendering so the first frame
      // already shows the body at its live orbital position (the bookmarked
      // coords are stale for orbiting bodies).  This must run after the
      // streamer has spawned the sector's entities and updateOrbits has moved
      // them to the current simulation time.
      if (tier === 'system') {
        const resolved = selectionState.resolvePending(world);
        const pos = resolved === null ? undefined : positions.get(resolved);
        if (pos) {
          camera.x = pos.x;
          camera.y = pos.y;
        }
      }

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
      let result = renderFrame({
        cache,
        camera: localCam,
        canvas,
        ctx2d,
        originX: renderOriginX,
        originY: renderOriginY,
        range,
        renderer,
        seed,
        threeMode: threeMode || threeActive,
        tier,
        world,
      });

      // Draw the Three.js tiers onto the renderer's own canvas behind the
      // transparent 2D canvas. `renderFrame` above has already run
      // `applyBodyScale`, so the system bodies' radii are floored before Three
      // reads them; the star tier reads the sector cache directly and returns its
      // own drawn count.
      if (threeActive && threeRenderer) {
        threeRenderer.updateStarfield(seed, renderOriginX, renderOriginY, camAbsX, camAbsY);
        if (tier === 'system') {
          const three = threeRenderer;
          // Anchor the 3D camera + pan to the focused system's orbital plane, so a
          // low tilt reads as a true top-down (orbits as circles) regardless of how
          // the disk is oriented in space.
          const planeNormal = focusedSystem?.diskNormal ?? WORLD_PLANE_NORMAL;
          controller.setSystemPlane(planeNormal[0], planeNormal[1], planeNormal[2]);
          three.render({ azimuth: controller.azimuth, camera: localCam, focusZ: controller.focusZ, planeNormal, simSeconds, tilt: controller.tilt, world });
          drawBodyLabels3D(ctx2d, world, (x, y, z, out) => three.projectToScreen(x, y, z, out), localCam.zoom);
          renderedByThree = true;
        }
        else if (tier === 'star') {
          result = threeRenderer.renderStars({ cache, camera: localCam, originX: renderOriginX, originY: renderOriginY, range });
          renderedByThree = true;
        }
        else if (tier === 'galaxy-field') {
          result = threeRenderer.renderGalaxyField({ camera: localCam, originX: renderOriginX, originY: renderOriginY, seed });
          renderedByThree = true;
        }
        else if (tier === 'galaxy') {
          result = threeRenderer.renderGalaxy({ camera: localCam, originX: renderOriginX, originY: renderOriginY, seed });
          renderedByThree = true;
        }
        else if (tier === 'universe') {
          result = threeRenderer.renderUniverse({ camera: localCam, originX: renderOriginX, originY: renderOriginY, seed });
          renderedByThree = true;
        }
      }

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
            selectionState.select(null);
          }
          else {
            const renderable = renderables.get(selection.id);
            const discRadius = renderable?.kind === 'circle' ? renderable.radius : 0;
            if (threeActive && threeRenderer) {
              // Project through the perspective camera so the reticle tracks the
              // body once the view is orbited, tilted, or panned off-centre.
              const p = { sx: 0, sy: 0 };
              const pz = world.getStore(PositionZDef).get(selection.id)?.z ?? 0;
              if (threeRenderer.projectToScreen(pos.x, pos.y, pz, p))
                drawSelectReticle(ctx2d, p.sx, p.sy, discRadius * camera.zoom);
            }
            else {
              const screen = worldToView(pos.x, pos.y, localCam);
              drawSelectReticle(ctx2d, screen.vx, screen.vy, discRadius * camera.zoom);
            }
          }
        }
      }

      const status = streamer.status();
      lastDrawnCount = result < 0 ? status.stars + status.planets : result;

      // Snapshot the fully-composed scene (background + content + reticle +
      // cross-fade, but NO overlays) so clean frames can blit it back and only
      // redraw the cheap HUD on top. Skipped in Three mode: the scene lives on
      // the Three canvas and every frame is dirty, so this cache is never blitted
      // — copying the full-resolution canvas each frame would be pure overhead.
      if (threeActive) {
        sceneCacheValid = false;
      }
      else {
        sceneCacheCtx.clearRect(0, 0, sceneCache.width, sceneCache.height);
        sceneCacheCtx.drawImage(canvas, 0, 0);
        sceneCacheValid = true;
      }
    }
    else if (sceneCacheValid) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(sceneCache, 0, 0);
    }

    // Lightweight HUD overlays and DOM updates — cheap enough to run every
    // frame so the time display and frame-time sparkline stay live.
    frameStats.setCounter('drawn', lastDrawnCount);

    // Re-read: the reticle pass above may have cleared the selection.
    const currentSelection = selectionState.selection;
    const selKey = currentSelection ? selectionBookmarkKey(currentSelection, world) : null;
    const bookmarked = selKey !== null && bookmarks.some(b => bookmarkKey(b.kind, b.name) === selKey);
    inspector.update(world, currentSelection, selectionState.lockedId, bookmarked);
    bookmarkList.update(bookmarks);
    // The tree and the coordinate readout want the ABSOLUTE camera position.
    const camAbs = { ...camera, x: cameraAbsolute(renderOriginX, camera.x), y: cameraAbsolute(renderOriginY, camera.y) };
    navTree.update(buildNavState(seed, cache, camAbs, tier, world, currentSelection));
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
    drawHint(ctx2d, canvas, tier, renderedByThree ? `Three (${threeRenderer?.backendLabel ?? '…'})` : 'Canvas 2D');
    drawScaleBar(ctx2d, camera);
    drawCoords(ctx2d, camAbs, seed);
    timeControls.update(simSeconds);
  });
  renderSource.start();

  return (): void => {
    // Persist the final session state (camera, clock, speed) so the next visit
    // resumes here; this teardown is wired to `beforeunload`.
    writeSave({ ...save, simSeconds, speedIndex: timeControls.speedIndex, view: { azimuth: controller.azimuth, focusZ: controller.focusZ, tilt: controller.tilt, x: cameraAbsolute(renderOriginX, camera.x), y: cameraAbsolute(renderOriginY, camera.y), zoom: camera.zoom } });
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
    bookmarkList.dispose();
    resetViewButton.dispose();
    flattenButton.dispose();
    optionsMenu.dispose();
    threeBackend.dispose();
  };
}

function drawHint(ctx2d: CanvasRenderingContext2D, canvas: HTMLCanvasElement, tier: Tier, rendererLabel: string): void {
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = 'rgba(160, 190, 240, 0.55)';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(`${HINT}   ·   tier: ${tier}   ·   renderer: ${rendererLabel}`, 10, canvas.height - 8);
  ctx2d.restore();
}
