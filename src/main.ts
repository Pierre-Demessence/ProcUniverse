import type { Tier } from './lod/tier';

import { EcsWorld } from '@pierre/ecs';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { StarPhysicalDef } from './generation/stars';
import { SECTOR_SIZE } from './generation/universe';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import { selectTier, visibleSectors } from './lod/tier';
import { renderFrame } from './render/scene';
import { OrbitElementsDef, updateOrbits } from './sim/orbits';
import { createTimeControls } from './ui/time-controls';

const TARGET_MS = 1000 / 60;
const REBASE_DIST = SECTOR_SIZE * 8;
const FADE_MS = 220;
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
    fadeMsLeft = 0;
  };
  sizeCanvas();

  const controller = createCameraController(canvas);
  const timeControls = createTimeControls(container);

  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(StarPhysicalDef);

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

  // Frame the first system of the origin sector so there is content centred at
  // startup.
  const originSector = cache.get(0, 0);
  const focus = originSector.systems.length > 0
    ? originSector.systems[0]
    : { x: SECTOR_SIZE / 2, y: SECTOR_SIZE / 2 };
  controller.camera.x = focus.x;
  controller.camera.y = focus.y;
  controller.camera.zoom = canvas.height / 1400;

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
  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    simSeconds += (dt / 1000) * timeControls.timeScale;
    frameStats.sample(dt);

    const tier = selectTier(camera, currentTier);
    const tierChanged = tier !== currentTier;
    currentTier = tier;
    const range = visibleSectors(camera);

    // Rebase the render origin when the camera drifts far from it; respawn the
    // streamed systems relative to the new origin.
    if (Math.abs(camera.x - renderOriginX) > REBASE_DIST || Math.abs(camera.y - renderOriginY) > REBASE_DIST) {
      renderOriginX = Math.round(camera.x / SECTOR_SIZE) * SECTOR_SIZE;
      renderOriginY = Math.round(camera.y / SECTOR_SIZE) * SECTOR_SIZE;
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
      fadeMsLeft = FADE_MS;
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
      ctx2d.globalAlpha = Math.min(1, fadeMsLeft / FADE_MS);
      ctx2d.drawImage(fadeCanvas, 0, 0);
      ctx2d.restore();
      fadeMsLeft -= dt;
    }

    const status = streamer.status();
    frameStats.setCounter('drawn', result < 0 ? status.stars + status.planets : result);

    drawStatsOverlay(ctx2d, frameStats, { targetMs: TARGET_MS });
    drawHint(ctx2d, canvas, tier);
    timeControls.update(simSeconds);
  });
  renderSource.start();

  return (): void => {
    renderSource.stop();
    unsubscribe();
    resizeObserver.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    controller.dispose();
    timeControls.dispose();
  };
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
