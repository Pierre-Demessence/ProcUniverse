import type { Camera } from '@pierre/ecs/modules/camera';

import type { SystemData } from './generation/universe';
import type { Tier } from './lod/tier';
import type { Selection } from './pick';
import type { NavNode, NavState, NavSystem } from './ui/nav-tree';

import { EcsWorld } from '@pierre/ecs';
import { worldToView } from '@pierre/ecs/modules/camera';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { CLICK_SLOP_PX, GALAXY_SPRITE_SCALE, REBASE_SECTORS, STATS_HUD_GAP_PX, STATS_HUD_RIGHT_RESERVE_PX, STATS_HUD_TOP_PX, STATS_HUD_WIDTH_PX, SYSTEM_VIEW_AU, TIER_FADE_MS } from './config';
import { BlackHoleDef, galaxyAt } from './generation/galaxies';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import { selectTier, visibleSectors } from './lod/tier';
import { findEntityByName, pickBodyAt, pickGalaxyAt } from './pick';
import { drawCoords } from './render/draw-coords';
import { drawScaleBar } from './render/scale-bar';
import { renderFrame } from './render/scene';
import { drawSelectReticle } from './render/select-reticle';
import { SECTOR_SIZE } from './scale';
import { OrbitElementsDef, updateOrbits } from './sim/orbits';
import { createInspector } from './ui/inspector';
import { createNavTree } from './ui/nav-tree';
import { createTimeControls } from './ui/time-controls';

const TARGET_MS = 1000 / 60;
const REBASE_DIST = SECTOR_SIZE * REBASE_SECTORS;
const HINT = 'Drag to pan  ·  Scroll to zoom';

/**
 * App entry. Wires the ECS world, the LOD tier system (sector streaming at the
 * system tier; immediate-mode star dots and galaxy-density glows when zoomed
 * out), the camera, and the rAF render loop.
 */
export function start(container: HTMLElement, seed: number): () => void {
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
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
    fadeMsLeft = 0;
    sceneCacheValid = false;
  };
  sizeCanvas();

  const controller = createCameraController(canvas);
  const timeControls = createTimeControls(container);
  const inspector = createInspector(container);

  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
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

  // Frame the home galaxy's centre at startup so its central black hole is in
  // view; fall back to the first system (or the sector centre) if absent.
  const homeGalaxy = galaxyAt(seed, 0, 0);
  const originSector = cache.get(0, 0);
  const focus = homeGalaxy
    ? { x: homeGalaxy.centerX, y: homeGalaxy.centerY }
    : originSector.systems.length > 0
      ? originSector.systems[0]
      : { x: SECTOR_SIZE / 2, y: SECTOR_SIZE / 2 };
  controller.camera.x = focus.x;
  controller.camera.y = focus.y;
  controller.camera.zoom = canvas.height / SYSTEM_VIEW_AU;

  // Floating render origin: everything is drawn relative to this so the renderer
  // works on small, precise coordinates however far the camera travels. Snapped
  // to the sector grid, rebased only when the camera drifts far from it.
  let renderOriginX = Math.round(controller.camera.x / SECTOR_SIZE) * SECTOR_SIZE;
  let renderOriginY = Math.round(controller.camera.y / SECTOR_SIZE) * SECTOR_SIZE;

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
  let simSeconds = 0;
  let currentTier: Tier = 'system';

  // Body selection (system tier only). A pointer gesture is treated as a pick
  // only when it barely moved — a real drag pans the view and never selects.
  // Escape and empty-space clicks clear the selection; the render loop clears it
  // when the body streams out or the tier changes.
  let selection: Selection | null = null;
  let pointerDownX = 0;
  let pointerDownY = 0;

  const toBackingPx = (clientX: number, clientY: number): { bx: number; by: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      bx: (clientX - rect.left) * (canvas.width / rect.width),
      by: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onPickDown = (e: PointerEvent): void => {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
  };
  const onPickUp = (e: PointerEvent): void => {
    // Ignore releases over the HUD panels (tree / inspector / time): those are
    // their own clicks, not a canvas pick that should re-select or clear.
    if (e.target !== canvas)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX)
      return;
    const { bx, by } = toBackingPx(e.clientX, e.clientY);
    const localCam = { ...camera, x: camera.x - renderOriginX, y: camera.y - renderOriginY };
    if (currentTier === 'system') {
      selection = pickBodyAt(world, localCam, bx, by);
    }
    else if (currentTier === 'galaxy-field') {
      const galaxy = pickGalaxyAt(seed, localCam, renderOriginX, renderOriginY, bx, by);
      selection = galaxy ? { galaxy, kind: 'galaxy' } : null;
    }
  };
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape')
      selection = null;
  };
  canvas.addEventListener('pointerdown', onPickDown);
  window.addEventListener('pointerup', onPickUp);
  window.addEventListener('keydown', onPickKey);

  // Location tree (top-left): clicking a body node pins it in the inspector,
  // resolving the streamed entity by its unique catalogue name. Galaxy nodes
  // recompute the galaxy under the camera; the Universe node is not selectable.
  const navTree = createNavTree(container, {
    onSelect(node: NavNode): void {
      if (node.kind === 'galaxy') {
        const g = galaxyAt(seed, camera.x, camera.y);
        selection = g ? { galaxy: g, kind: 'galaxy' } : null;
      }
      else if (node.kind === 'star' || node.kind === 'planet') {
        const id = findEntityByName(world, node.name);
        if (id !== null)
          selection = { id, kind: node.kind };
      }
    },
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

  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    simSeconds += (dt / 1000) * timeControls.timeScale;
    frameStats.sample(dt);

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

    // At the system tier orbits animate so every frame is dirty; at other
    // tiers a cross-fade, camera move, viewport change, or selection change
    // dirties the view.
    const dirty = tier === 'system' || tierChanged || camMoved || vpChanged || selChanged || fadeMsLeft > 0;

    if (dirty) {
      const range = visibleSectors(camera);

      // Rebase the render origin so the renderer always draws on small, precise
      // local coordinates. At the system tier we rebase onto the focused star
      // itself, dropping planet coords to tens of AU: without this, discs drawn at
      // ~10^5 AU local coordinates lose canvas path precision and render as jagged
      // blobs. Zoomed out, snap to the sector grid and rebase only on large
      // drifts. Respawn the streamed systems whenever the origin moves.
      let originX = renderOriginX;
      let originY = renderOriginY;
      if (tier === 'system') {
        const focus = nearestStar(cache, camera.x, camera.y);
        originX = focus ? focus.x : Math.round(camera.x / SECTOR_SIZE) * SECTOR_SIZE;
        originY = focus ? focus.y : Math.round(camera.y / SECTOR_SIZE) * SECTOR_SIZE;
      }
      else if (Math.abs(camera.x - renderOriginX) > REBASE_DIST || Math.abs(camera.y - renderOriginY) > REBASE_DIST) {
        originX = Math.round(camera.x / SECTOR_SIZE) * SECTOR_SIZE;
        originY = Math.round(camera.y / SECTOR_SIZE) * SECTOR_SIZE;
      }
      if (originX !== renderOriginX || originY !== renderOriginY) {
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

      // Capture the previous (old-tier) frame to cross-fade out of on a tier change.
      if (tierChanged) {
        fadeCtx.clearRect(0, 0, fadeCanvas.width, fadeCanvas.height);
        fadeCtx.drawImage(canvas, 0, 0);
        fadeMsLeft = TIER_FADE_MS;
      }

      const localCam = { ...camera, x: camera.x - renderOriginX, y: camera.y - renderOriginY };
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
        tier,
        world,
      });

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
        else {
          const pos = tier === 'system' ? positions.get(selection.id) : undefined;
          if (!pos) {
            selection = null;
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
    inspector.update(world, selection);
    navTree.update(buildNavState(seed, cache, camera, tier, world, selection));
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
    drawCoords(ctx2d, camera, seed);
    timeControls.update(simSeconds);
  });
  renderSource.start();

  return (): void => {
    renderSource.stop();
    unsubscribe();
    resizeObserver.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    canvas.removeEventListener('pointerdown', onPickDown);
    window.removeEventListener('pointerup', onPickUp);
    window.removeEventListener('keydown', onPickKey);
    controller.dispose();
    timeControls.dispose();
    inspector.dispose();
    navTree.dispose();
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
      system = { name: focus.name, planets: focus.planets.map(p => ({ name: p.name })) };
  }
  return {
    galaxy: galaxy ? { name: galaxy.name } : null,
    selectedKey: selectionKey(world, selection),
    system,
    tier,
  };
}

/** The tree-node `key` matching the current selection, for highlighting. */
function selectionKey(world: EcsWorld, selection: Selection | null): string | null {
  if (!selection)
    return null;
  if (selection.kind === 'galaxy')
    return `galaxy:${selection.galaxy.name}`;
  return world.getStore(NameDef).get(selection.id)?.name ?? null;
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
