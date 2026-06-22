import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Canvas2DRenderContext } from '@pierre/ecs/modules/render-canvas2d';
import type { Renderer } from '@pierre/ecs/renderer';

import type { SectorCache } from '../lod/sector-cache';
import type { SectorRange, Tier } from '../lod/tier';

import { cameraToView } from '@pierre/ecs/modules/camera';

import { drawOrbitRings } from '../sim/orbits';
import { drawGalaxy } from './draw-galaxy';
import { drawGalaxyField } from './draw-galaxy-field';
import { drawBodyLabels } from './draw-labels';
import { drawStars } from './draw-stars';
import { drawReferenceGrid } from './grid';

const BACKGROUND = '#05060d';

export interface FrameDeps {
  cache: SectorCache;
  /** Camera shifted into the floating render-origin frame (small coords). */
  camera: Camera;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  originX: number;
  originY: number;
  range: SectorRange;
  renderer: Renderer<Canvas2DRenderContext>;
  seed: number;
  tier: Tier;
  world: EcsWorld;
}

/**
 * Compose one frame for the active LOD tier and return the number of objects
 * drawn (star dots or galaxy glows), or -1 at the system tier where the count
 * comes from the streamer. Whichever tier is active, the on-screen object count
 * stays bounded — that is the point of the tier system. `camera` is already in
 * the render-origin frame; ECS entity positions are stored in the same frame.
 */
export function renderFrame(deps: FrameDeps): number {
  const { cache, camera, canvas, ctx2d, originX, originY, range, renderer, seed, tier, world } = deps;

  ctx2d.fillStyle = BACKGROUND;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  if (tier === 'galaxy' || tier === 'universe')
    return drawGalaxy(ctx2d, camera, seed, originX, originY);

  if (tier === 'galaxy-field')
    return drawGalaxyField(ctx2d, camera, seed, originX, originY);

  if (tier === 'star')
    return drawStars(ctx2d, camera, cache, range, originX, originY);

  drawReferenceGrid(ctx2d, camera, originX, originY);
  drawOrbitRings(ctx2d, camera, world);
  renderer.render({ ctx2d, view: cameraToView(camera), world });
  drawBodyLabels(ctx2d, camera, world);
  return -1;
}
