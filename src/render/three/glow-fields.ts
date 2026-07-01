/**
 * Three-only glow-sprite iterators for the aggregate tiers, feeding the Three
 * renderer's instanced additive glow mesh. Each mirrors the corresponding
 * Canvas 2D `draw-*` tier's sprite computation but emits render-origin-relative
 * WORLD coordinates + a world radius (the GPU projects), leaving the Canvas 2D
 * files untouched. Keep these in sync with their `draw-*` counterparts.
 */

import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';
import { clamp, lerp } from '@pierre/ecs/modules/math';

import { GALAXY_CELL_LY } from '../../config/data';
import { GALAXY_SPRITE_SCALE } from '../../config/render';
import { cosmicDensity, galaxiesInRect, galaxyActivityAt, galaxyDensityAt, galaxyRepresentativeActivity } from '../../generation/galaxies';
import { AU_PER_LY } from '../../generation/units';
import { SECTOR_SIZE } from '../../scale';
import { bucketedPopulationColor } from '../galaxy-sprites';

/** Sink for one glow sprite: local world centre, world radius, colour (0–255), alpha. */
export type GlowSink = (x: number, y: number, radius: number, r: number, g: number, b: number, alpha: number) => void;

/** A tier's glow iterator: emits every visible sprite to `sink`. */
export type GlowField = (cam: Camera, seed: number, originX: number, originY: number, sink: GlowSink) => void;

/** Opacity of a galaxy-field sprite; mirrors `drawGalaxyField`. */
const GALAXY_FIELD_ALPHA = 0.9;
/** Minimum on-screen sprite radius (px); mirrors `drawGalaxyField`. */
const MIN_SPRITE_PX = 2;
/** Aggregate-cell target size (px); mirrors `drawGalaxy` / `drawUniverse`. */
const TARGET_CELL_PX = 34;

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

/**
 * GALAXY tier: a soft additive glow per aggregate cell — size and brightness from
 * the galaxy-density field, colour from star-formation activity. Mirrors
 * `drawGalaxy` (power-of-two cells sized to stay ≥ `TARGET_CELL_PX` on screen).
 */
export const forEachGalaxyGlow: GlowField = (cam, seed, originX, originY, sink) => {
  const sectorPx = SECTOR_SIZE * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(sectorPx, 1e-9))));
  const cellWorld = SECTOR_SIZE * (2 ** level);
  const rect = cameraViewRect(cam);
  const absX = rect.x + originX;
  const absY = rect.y + originY;
  const minCx = Math.floor(absX / cellWorld);
  const maxCx = Math.floor((absX + rect.w) / cellWorld);
  const minCy = Math.floor(absY / cellWorld);
  const maxCy = Math.floor((absY + rect.h) / cellWorld);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * cellWorld;
      const wyAbs = (cy + 0.5) * cellWorld;
      const norm = galaxyDensityAt(seed, wxAbs, wyAbs);
      if (norm < 0.01)
        continue;
      const [r, g, b] = bucketedPopulationColor(galaxyActivityAt(seed, wxAbs, wyAbs));
      sink(wxAbs - originX, wyAbs - originY, cellWorld * (0.4 + 0.5 * norm), r, g, b, clamp(0.1 + 0.5 * norm, 0, 0.7));
    }
  }
};

/**
 * UNIVERSE tier: aggregate the cosmic-web density into a soft additive glow —
 * dense clusters bright and red, voids dim and blue. Mirrors `drawUniverse`
 * (super-cells sized in galaxy-cells to stay ≥ `TARGET_CELL_PX` on screen).
 */
export const forEachUniverseGlow: GlowField = (cam, seed, originX, originY, sink) => {
  const galaxyCell = GALAXY_CELL_LY * AU_PER_LY;
  const cellPx = galaxyCell * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(cellPx, 1e-9))));
  const superCell = galaxyCell * (2 ** level);
  const rect = cameraViewRect(cam);
  const absX = rect.x + originX;
  const absY = rect.y + originY;
  const minCx = Math.floor(absX / superCell);
  const maxCx = Math.floor((absX + rect.w) / superCell);
  const minCy = Math.floor(absY / superCell);
  const maxCy = Math.floor((absY + rect.h) / superCell);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * superCell;
      const wyAbs = (cy + 0.5) * superCell;
      const cosmic = cosmicDensity(seed, Math.floor(wxAbs / galaxyCell), Math.floor(wyAbs / galaxyCell));
      if (cosmic < 0.05)
        continue;
      const [r, g, b] = bucketedPopulationColor(lerp(0.6, 0.2, cosmic));
      sink(wxAbs - originX, wyAbs - originY, superCell * (0.4 + 0.5 * cosmic), r, g, b, clamp(0.08 + 0.4 * cosmic, 0, 0.6));
    }
  }
};
