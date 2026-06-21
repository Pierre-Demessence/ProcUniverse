import { EcsWorld } from '@pierre/ecs';
import { Canvas2DRenderer, RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { drawStatsOverlay, FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { createCameraController } from './camera/camera-controller';
import { renderScene } from './render/scene';

const TARGET_MS = 1000 / 60;
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

  // Placeholder star at the origin — validates the camera-driven ECS render
  // pipeline end to end. Procedural generation replaces it in Phase 1.
  const star = world.createEntity();
  world.getStore(PositionDef).set(star, { x: 0, y: 0 });
  world.getStore(RenderableDef).set(star, {
    fill: '#ffd86b',
    kind: 'circle',
    lineWidth: 2,
    radius: 40,
    stroke: '#fff2b0',
  });

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

  const renderSource = new AnimationFrameTickSource();
  const unsubscribe = renderSource.subscribe((info) => {
    frameStats.sample(info.deltaMs ?? 0);
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
