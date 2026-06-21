import { EcsWorld } from '@pierre/ecs';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { spawnSector } from './generation/spawn';
import { generateSectorData, SECTOR_SIZE } from './generation/universe';
import { renderScene } from './render/scene';
import { OrbitDef, updateOrbits } from './sim/orbits';

const TARGET_MS = 1000 / 60;
const WORLD_SEED = 1337;
const TIME_SCALE = 2;
const HINT = 'Drag to pan  ·  Scroll to zoom';

/**
 * Phase 0 scaffold: a pannable, zoomable empty plane with an FPS HUD. Wires the
 * ECS world, the camera-driven Canvas2D renderer, and the rAF loop that later
 * phases extend with procedural generation and LOD streaming.
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

  // Phase 1: one deterministic sector of star systems whose planets ride
  // analytic Kepler orbits. Regenerating the same sector is bit-identical.
  const sector = generateSectorData(WORLD_SEED, 0, 0);
  const counts = spawnSector(world, sector);
  // The spawn `set`s queued one-time ComponentAdded lifecycle events; nothing
  // subscribes, so drop them. (Per-frame orbit writes mutate in place and emit
  // nothing — see updateOrbits.)
  world.lifecycle.clear();

  const renderer = new Canvas2DRenderer();
  const frameStats = new FrameStats();
  frameStats.setCounter('stars', counts.stars);
  frameStats.setCounter('planets', counts.planets);

  // Keep the camera viewport equal to the canvas backing size so the renderer's
  // cull rect and the pointer math share a single coordinate space.
  const syncViewport = (): void => {
    sizeCanvas();
    controller.camera.viewportW = canvas.width;
    controller.camera.viewportH = canvas.height;
  };
  syncViewport();

  // Frame the first generated system so there is content centred at startup.
  const focus = sector.systems.length > 0
    ? sector.systems[0]
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

  let clockMs = 0;
  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    const dt = info.deltaMs ?? 0;
    clockMs += dt;
    frameStats.sample(dt);
    updateOrbits(world, (clockMs / 1000) * TIME_SCALE);
    renderScene({ camera: controller.camera, canvas, ctx2d, renderer, world });
    drawStatsOverlay(ctx2d, frameStats, { targetMs: TARGET_MS });
    drawHint(ctx2d, canvas);
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

function drawHint(ctx2d: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = 'rgba(160, 190, 240, 0.55)';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(HINT, 10, canvas.height - 8);
  ctx2d.restore();
}
