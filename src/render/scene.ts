import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Canvas2DRenderContext } from '@pierre/ecs/modules/render-canvas2d';
import type { Renderer } from '@pierre/ecs/renderer';

import type { SectorCache } from '../lod/sector-cache';
import type { SectorRange, Tier } from '../lod/tier';

import { cameraToView } from '@pierre/ecs/modules/camera';

import { drawOrbitRings } from '../sim/orbits';
import { applyBodyScale } from './body-scale';
import { drawGalaxy } from './draw-galaxy';
import { drawGalaxyField, drawGalaxyFieldLabels } from './draw-galaxy-field';
import { drawBodyLabels } from './draw-labels';
import { drawStars } from './draw-stars';
import { drawUniverse } from './draw-universe';
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
  threeMode: boolean;
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
  const { cache, camera, canvas, ctx2d, originX, originY, range, renderer, seed, threeMode, tier, world } = deps;

  // In Three mode the system-tier bodies are drawn by the WebGPU renderer on its
  // own canvas behind this one, so keep the 2D canvas transparent (they show
  // through) and draw only the screen-space overlays on top. Every other tier
  // still renders on Canvas 2D, whose opaque fill covers the Three canvas.
  if (threeMode && tier === 'system') {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    drawReferenceGrid(ctx2d, camera, originX, originY);
    drawOrbitRings(ctx2d, camera, world);
    applyBodyScale(world, camera.zoom);
    drawBodyLabels(ctx2d, camera, world);
    return -1;
  }

  // Star tier in Three mode: the instanced star field is drawn by the Three
  // renderer behind this canvas, so keep the 2D canvas transparent for the HUD.
  if (threeMode && tier === 'star') {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    return -1;
  }

  // Galaxy and universe tiers in Three mode: the aggregate glow is drawn by
  // Three; there are no labels at these tiers, so keep the 2D canvas clear.
  if (threeMode && (tier === 'galaxy' || tier === 'universe')) {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    return -1;
  }

  // Galaxy-field tier in Three mode: the galaxy glow sprites are drawn by Three;
  // keep only the NGC labels on the transparent 2D overlay so they stay crisp.
  if (threeMode && tier === 'galaxy-field') {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    drawGalaxyFieldLabels(ctx2d, camera, seed, originX, originY);
    return -1;
  }

  ctx2d.fillStyle = BACKGROUND;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  if (tier === 'galaxy')
    return drawGalaxy(ctx2d, camera, seed, originX, originY);

  if (tier === 'universe')
    return drawUniverse(ctx2d, camera, seed, originX, originY);

  if (tier === 'galaxy-field')
    return drawGalaxyField(ctx2d, camera, seed, originX, originY);

  if (tier === 'star')
    return drawStars(ctx2d, camera, cache, range, originX, originY);

  drawReferenceGrid(ctx2d, camera, originX, originY);
  drawOrbitRings(ctx2d, camera, world);
  applyBodyScale(world, camera.zoom);
  renderer.render({ ctx2d, view: cameraToView(camera), world });
  drawBodyLabels(ctx2d, camera, world);
  return -1;
}
