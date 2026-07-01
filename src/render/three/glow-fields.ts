/**
 * Three-only glow-sprite iterators for the aggregate tiers, feeding the Three
 * renderer's instanced additive glow mesh. Each mirrors the corresponding
 * Canvas 2D `draw-*` tier's sprite computation but emits render-origin-relative
 * WORLD coordinates + a world radius (the GPU projects), leaving the Canvas 2D
 * files untouched. Keep these in sync with their `draw-*` counterparts.
 */

import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { GALAXY_SPRITE_SCALE } from '../../config/render';
import { galaxiesInRect, galaxyRepresentativeActivity } from '../../generation/galaxies';
import { bucketedPopulationColor } from '../galaxy-sprites';

/** Sink for one glow sprite: local world centre, world radius, colour (0–255), alpha. */
export type GlowSink = (x: number, y: number, radius: number, r: number, g: number, b: number, alpha: number) => void;

/** A tier's glow iterator: emits every visible sprite to `sink`. */
export type GlowField = (cam: Camera, seed: number, originX: number, originY: number, sink: GlowSink) => void;

/** Opacity of a galaxy-field sprite; mirrors `drawGalaxyField`. */
const GALAXY_FIELD_ALPHA = 0.9;
/** Minimum on-screen sprite radius (px); mirrors `drawGalaxyField`. */
const MIN_SPRITE_PX = 2;

/**
 * GALAXY-FIELD tier: one additive glow per galaxy in view — centre from the
 * galaxy, world radius from its size (min-floored on screen), colour from its
 * dominant population. Mirrors the sprite pass of `drawGalaxyField`.
 */
export const forEachGalaxyFieldGlow: GlowField = (cam, seed, originX, originY, sink) => {
  const rect = cameraViewRect(cam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;
  for (const g of galaxiesInRect(seed, minX, minY, minX + rect.w, minY + rect.h)) {
    const radius = Math.max(MIN_SPRITE_PX / cam.zoom, g.radius * GALAXY_SPRITE_SCALE);
    const [r, green, b] = bucketedPopulationColor(galaxyRepresentativeActivity(g));
    sink(g.centerX - originX, g.centerY - originY, radius, r, green, b, GALAXY_FIELD_ALPHA);
  }
};
