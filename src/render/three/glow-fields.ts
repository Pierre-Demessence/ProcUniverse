/**
 * Glow-sprite iterators for the aggregate tiers, feeding the Three renderer's
 * instanced additive glow mesh. Each emits render-origin-relative WORLD
 * coordinates and a world radius; the GPU projects them.
 */

import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';
import { clamp, lerp } from '@pierre/ecs/modules/math';

import { GALAXY_CELL_LY } from '../../config/data';
import { GALAXY_SPRITE_SCALE } from '../../config/render';
import { cosmicDensity, galaxiesInBox, galaxyRepresentativeActivity, galaxySampleAt } from '../../generation/galaxies';
import { AU_PER_LY } from '../../generation/units';
import { bucketedPopulationColor } from '../galaxy-sprites';

/** Sink for one glow sprite: local world centre, world radius, colour (0–255), alpha. */
export type GlowSink = (x: number, y: number, radius: number, r: number, g: number, b: number, alpha: number) => void;

/**
 * A tier's glow iterator: emits every visible sprite to `sink`. `focusZ` is the
 * absolute height of the camera focus (AU); these top-down tiers show the space
 * around it.
 */
export type GlowField = (cam: Camera, seed: number, originX: number, originY: number, focusZ: number, sink: GlowSink) => void;

/** Opacity of a galaxy-field sprite. */
const GALAXY_FIELD_ALPHA = 0.9;
/** Minimum on-screen sprite radius (px). */
const MIN_SPRITE_PX = 2;
/** Aggregate-cell target size (px) for the galaxy and universe tiers. */
const TARGET_CELL_PX = 34;

/**
 * GALAXY-FIELD tier: one additive glow per galaxy in the cube of space in view
 * (the view rectangle, as deep as it is wide, around the focus height) — centre
 * from the galaxy, world radius from its size (min-floored on screen), colour
 * from its dominant population.
 */
export const forEachGalaxyFieldGlow: GlowField = (cam, seed, originX, originY, focusZ, sink) => {
  const rect = cameraViewRect(cam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;
  const halfDepth = Math.max(rect.w, rect.h) / 2;
  for (const g of galaxiesInBox(seed, minX, minY, focusZ - halfDepth, minX + rect.w, minY + rect.h, focusZ + halfDepth)) {
    const radius = Math.max(MIN_SPRITE_PX / cam.zoom, g.radius * GALAXY_SPRITE_SCALE);
    const [r, green, b] = bucketedPopulationColor(galaxyRepresentativeActivity(g));
    sink(g.centerX - originX, g.centerY - originY, radius, r, green, b, GALAXY_FIELD_ALPHA);
  }
};

/**
 * GALAXY tier: a soft additive glow per aggregate cell of the galaxy-density
 * field's slice at the focus height — size and brightness from the density,
 * colour from star-formation activity. Power-of-two multiples of a light-year
 * are sized to stay ≥ `TARGET_CELL_PX` on screen.
 */
export const forEachGalaxyGlow: GlowField = (cam, seed, originX, originY, focusZ, sink) => {
  const lyPx = AU_PER_LY * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(lyPx, 1e-9))));
  const cellWorld = AU_PER_LY * (2 ** level);
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
      const { activity, density: norm } = galaxySampleAt(seed, wxAbs, wyAbs, focusZ);
      if (norm < 0.01)
        continue;
      const [r, g, b] = bucketedPopulationColor(activity);
      sink(wxAbs - originX, wyAbs - originY, cellWorld * (0.4 + 0.5 * norm), r, g, b, clamp(0.1 + 0.5 * norm, 0, 0.7));
    }
  }
};

/**
 * UNIVERSE tier: aggregate the cosmic-web density's slice at the focus height
 * into a soft additive glow — dense clusters bright and red, voids dim and blue.
 * Super-cells are sized in galaxy-cells to stay ≥ `TARGET_CELL_PX` on screen.
 */
export const forEachUniverseGlow: GlowField = (cam, seed, originX, originY, focusZ, sink) => {
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
  const cellZ = Math.floor(focusZ / galaxyCell);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * superCell;
      const wyAbs = (cy + 0.5) * superCell;
      const cosmic = cosmicDensity(seed, Math.floor(wxAbs / galaxyCell), Math.floor(wyAbs / galaxyCell), cellZ);
      if (cosmic < 0.05)
        continue;
      const [r, g, b] = bucketedPopulationColor(lerp(0.6, 0.2, cosmic));
      sink(wxAbs - originX, wyAbs - originY, superCell * (0.4 + 0.5 * cosmic), r, g, b, clamp(0.08 + 0.4 * cosmic, 0, 0.6));
    }
  }
};
