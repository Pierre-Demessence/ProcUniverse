import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Canvas2DRenderContext } from '@pierre/ecs/modules/render-canvas2d';
import type { Renderer } from '@pierre/ecs/renderer';

import { cameraToView } from '@pierre/ecs/modules/camera';

import { drawReferenceGrid } from './grid';

const BACKGROUND = '#05060d';

export interface SceneDeps {
  camera: Camera;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  renderer: Renderer<Canvas2DRenderContext>;
  world: EcsWorld;
}

/**
 * One frame: clear, draw the reference grid, then draw all ECS entities
 * through the camera view (the renderer culls anything off-screen).
 */
export function renderScene(deps: SceneDeps): void {
  const { camera, canvas, ctx2d, renderer, world } = deps;

  ctx2d.fillStyle = BACKGROUND;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  drawReferenceGrid(ctx2d, camera);

  renderer.render({ ctx2d, view: cameraToView(camera), world });
}
