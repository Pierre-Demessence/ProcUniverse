import { EcsWorld } from '@pierre/ecs';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { SECTOR_SIZE } from './generation/universe';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import type { Tier } from './lod/tier';
import { selectTier, visibleSectors } from './lod/tier';
import { renderFrame } from './render/scene';
import { OrbitDef, updateOrbits } from './sim/orbits';

const TARGET_MS = 1000 / 60;
const WORLD_SEED = 1337;
const TIME_SCALE = 2;
const HINT = 'Drag to pan  ·  Scroll to zoom';

/**
 * App entry. Wires the ECS world, the LOD tier system (sector streaming at the
 * system tier; immediate-mode star dots and galaxy-density glows when zoomed
 * out), the camera, and the rAF render loop.
 */
export function start(container: HTMLElement): () => void {
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
  container.append(canvas);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d)
    throw new Error('ProcUniverse: 2D canvas context is unavailable.');

  // Size the backing store to device pixels before the camera is created, so it
  // reads real dimensions rather than the canvas default (300x150).
  const sizeCanvas = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  };
  sizeCanvas();

  const controller = createCameraController(canvas);

  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(OrbitDef);

  // Deterministic universe: sectors are generated on demand and cached; the
  // streamer spawns/despawns full systems for the sectors in view at the system
  // tier.
  const cache = new SectorCache(WORLD_SEED);
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
  let clockMs = 0;
  let currentTier: Tier = 'system';
  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    clockMs += dt;
    frameStats.sample(dt);

    const tier = selectTier(camera, currentTier);
    currentTier = tier;
    const range = visibleSectors(camera);

    // Stream full systems only at the system tier; otherwise despawn them.
    if (tier === 'system')
      streamer.update(range);
    else
      streamer.clear();
    // Flush despawns, drop the (subscriber-less) lifecycle events the
    // spawns/despawns queued, and clear the stores' dirty sets (nothing
    // consumes them) before anything reads the entity set.
    world.endOfTick();
    world.clearAllDirty();

    if (tier === 'system')
      updateOrbits(world, (clockMs / 1000) * TIME_SCALE);

    const result = renderFrame({ cache, camera, canvas, ctx2d, range, renderer, seed: WORLD_SEED, tier, world });
    const status = streamer.status();
    frameStats.setCounter('drawn', result < 0 ? status.stars + status.planets : result);

    drawStatsOverlay(ctx2d, frameStats, { targetMs: TARGET_MS });
    drawHint(ctx2d, canvas, tier);
  });
  renderSource.start();

  return (): void => {
    renderSource.stop();
    unsubscribe();
    resizeObserver.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    controller.dispose();
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
