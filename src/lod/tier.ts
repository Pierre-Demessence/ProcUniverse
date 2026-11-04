import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { DISK_OUTER_MAX_AU, GALAXY_CELL_LY } from '../config/data';
import { CAMERA_FOV_DEG, GALAXY_FIELD_LY, GALAXY_TIER_LY, STAR_BLEND_MAX_AU, STAR_BLEND_MIN_AU, STAR_HANDOFF_START, STAR_MAX_REACH_LY, STAR_MIN_REACH_LY, STAR_REACH_SPAN_FACTOR, SYSTEM_TIER_MAX_AU, TIER_BAND_FACTOR, TIER_HYSTERESIS, UNIVERSE_LY } from '../config/render';
import { AU_PER_LY } from '../generation/units';
import { SECTOR_SIZE } from '../scale';

/**
 * Level-of-detail tier. The representation switches with the camera's distance so the on-screen
 * draw count stays bounded regardless of how many bodies exist (in → out):
 * - `system`: full systems (star + planets + orbits), streamed as ECS entities.
 * - `star`: each system is a single bloomed sprite in a 3D neighbourhood.
 * - `galaxy`: one galaxy's per-aggregate-cell density glow.
 * - `galaxy-field`: each galaxy a discrete tinted sprite + label.
 * - `universe`: the cosmic-scale aggregate glow.
 */
export type Tier = 'galaxy' | 'galaxy-field' | 'star' | 'system' | 'universe';

/** Inclusive box of cubic sector coordinates. */
export interface SectorRange {
  maxSx: number;
  maxSy: number;
  maxSz: number;
  minSx: number;
  minSy: number;
  minSz: number;
}

/**
 * Reach (AU) of the focused system's bodies around its star — the widest planet
 * disk with room for eccentric orbits and moons, and far below the spacing of
 * neighbouring stars. In the cross-fade band, bodies beyond it belong to
 * neighbouring systems, which are drawn as sprites instead.
 */
export const SYSTEM_LAYER_REACH_AU = DISK_OUTER_MAX_AU * 4;

// The system→star boundary is configured in AU (a realistic system is a
// vanishing fraction of a light-year) and converted to light-years here.
const STAR_AT = SYSTEM_TIER_MAX_AU / AU_PER_LY;

const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEG * Math.PI / 180) / 2);

/**
 * Distance (AU) from the perspective camera to its focus: the one conversion
 * between the stored `zoom` (px per AU at the focus) and where the camera sits,
 * so the vertical field of view spans exactly `viewportH / zoom` at the focus.
 * Independent of the viewport's width, so the tier does not depend on the
 * window's aspect ratio.
 */
export function cameraDistance(cam: Camera): number {
  return (cam.viewportH / cam.zoom / 2) / HALF_FOV_TAN;
}

/** `cameraDistance` in light-years, the unit the tier thresholds are in. */
export function distanceLy(cam: Camera): number {
  return cameraDistance(cam) / AU_PER_LY;
}

// Tiers ordered by distance (in → out); `BOUNDARIES[i]` is the camera distance
// (light-years) separating `TIER_ORDER[i]` from the next tier out.
const TIER_ORDER = ['system', 'star', 'galaxy', 'galaxy-field', 'universe'] as const;
const BOUNDARIES = [STAR_AT, GALAXY_TIER_LY, GALAXY_FIELD_LY, UNIVERSE_LY];

/**
 * Choose the tier from the camera's distance to its focus, with a hysteresis
 * dead-band around the boundaries so a distance hovering at one doesn't thrash
 * (each crossing re-streams the view).
 */
export function selectTier(cam: Camera, prev: Tier): Tier {
  const dist = distanceLy(cam);
  let idx = BOUNDARIES.length;
  for (let i = 0; i < BOUNDARIES.length; i++) {
    const b = BOUNDARIES[i];
    if (b !== undefined && dist < b) {
      idx = i;
      break;
    }
  }
  const prevIdx = TIER_ORDER.indexOf(prev);
  const upper = BOUNDARIES[prevIdx];
  const lower = BOUNDARIES[prevIdx - 1];
  if (idx > prevIdx && upper !== undefined && dist < upper * TIER_HYSTERESIS)
    idx = prevIdx;
  else if (idx < prevIdx && lower !== undefined && dist > lower / TIER_HYSTERESIS)
    idx = prevIdx;
  return TIER_ORDER[idx] ?? prev;
}

/**
 * Inclusive range of sector coordinates overlapping the camera view, extended
 * through the focus height `focusZ` (absolute AU) by half the larger view span
 * on either side — the cube of space the view is looking into.
 */
export function visibleSectors(cam: Camera, focusZ: number): SectorRange {
  const r = cameraViewRect(cam);
  const halfDepth = Math.max(r.w, r.h) / 2;
  return {
    maxSx: Math.floor((r.x + r.w) / SECTOR_SIZE),
    maxSy: Math.floor((r.y + r.h) / SECTOR_SIZE),
    maxSz: Math.floor((focusZ + halfDepth) / SECTOR_SIZE),
    minSx: Math.floor(r.x / SECTOR_SIZE),
    minSy: Math.floor(r.y / SECTOR_SIZE),
    minSz: Math.floor((focusZ - halfDepth) / SECTOR_SIZE),
  };
}

/**
 * Radius (AU) of the star-tier sphere of stars drawn around the focus:
 * `STAR_REACH_SPAN_FACTOR` × the view's half-span, clamped to
 * `STAR_MIN_REACH_LY`–`STAR_MAX_REACH_LY`. Set by the zoom alone, so tilting or
 * orbiting the camera never adds or drops stars.
 */
export function starFieldReach(cam: Camera): number {
  const halfSpan = Math.max(cam.viewportW, cam.viewportH) / cam.zoom / 2;
  return Math.min(Math.max(halfSpan * STAR_REACH_SPAN_FACTOR, STAR_MIN_REACH_LY * AU_PER_LY), STAR_MAX_REACH_LY * AU_PER_LY);
}

/**
 * Half-depth (AU) of the box of space the galaxy-field tier scans around the
 * focus height: as deep as the view is wide, but at most half a galaxy cell, so
 * the widest view reads two cell layers instead of one per cell across. Until
 * the tier renders in 3D (universe-3d Phase 4) it shows a slab, not a cube.
 */
export function galaxyFieldHalfDepth(cam: Camera): number {
  const halfSpan = Math.max(cam.viewportW, cam.viewportH) / cam.zoom / 2;
  return Math.min(halfSpan, (GALAXY_CELL_LY * AU_PER_LY) / 2);
}

/** Inclusive range of sector coordinates overlapping the cube `(cx, cy, cz) ± halfExtent` (absolute AU). */
export function sectorsAround(cx: number, cy: number, cz: number, halfExtent: number): SectorRange {
  return {
    maxSx: Math.floor((cx + halfExtent) / SECTOR_SIZE),
    maxSy: Math.floor((cy + halfExtent) / SECTOR_SIZE),
    maxSz: Math.floor((cz + halfExtent) / SECTOR_SIZE),
    minSx: Math.floor((cx - halfExtent) / SECTOR_SIZE),
    minSy: Math.floor((cy - halfExtent) / SECTOR_SIZE),
    minSz: Math.floor((cz - halfExtent) / SECTOR_SIZE),
  };
}

/**
 * Whether sector `(sx, sy, sz)` has any point within `radius` of `(cx, cy, cz)`
 * (absolute AU): the distance from the point to the sector's nearest point. A
 * range from `sectorsAround` is a cube, whose corner sectors lie outside the
 * sphere of the same half-extent and need neither generating nor drawing.
 */
export function sectorWithinReach(sx: number, sy: number, sz: number, cx: number, cy: number, cz: number, radius: number): boolean {
  const dx = Math.max(sx * SECTOR_SIZE - cx, 0, cx - (sx + 1) * SECTOR_SIZE);
  const dy = Math.max(sy * SECTOR_SIZE - cy, 0, cy - (sy + 1) * SECTOR_SIZE);
  const dz = Math.max(sz * SECTOR_SIZE - cz, 0, cz - (sz + 1) * SECTOR_SIZE);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/** Hermite smooth-step of `x` from `edge0` to `edge1`, clamped to [0, 1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A cross-fade between two neighbouring tiers: pure `inner` up to `minLy` of
 * camera distance, pure `outer` from `maxLy`, smooth-stepped in log distance
 * between. Independent of the discrete tier, which keeps driving selection, the
 * HUD and labels. Both representations are perspective views of the same 3D
 * positions, so a swap needs no tilt easing.
 */
export interface TierBand {
  inner: Tier;
  maxLy: number;
  minLy: number;
  outer: Tier;
}

/** The bands in → out; `TIER_BANDS[i]` straddles `BOUNDARIES[i]`. */
export const TIER_BANDS: readonly TierBand[] = TIER_ORDER.slice(0, -1).map((inner, i) => ({
  inner,
  // The system ↔ star band is configured in AU; the others straddle their boundary.
  maxLy: i === 0 ? STAR_BLEND_MAX_AU / AU_PER_LY : BOUNDARIES[i]! * TIER_BAND_FACTOR,
  minLy: i === 0 ? STAR_BLEND_MIN_AU / AU_PER_LY : BOUNDARIES[i]! / TIER_BAND_FACTOR,
  outer: TIER_ORDER[i + 1]!,
}));

/** How far `distLy` has cross-faded across `band`: 0 = pure inner tier … 1 = pure outer tier. */
export function bandBlend(band: TierBand, distLy: number): number {
  return smoothstep(Math.log(band.minLy), Math.log(band.maxLy), Math.log(distLy));
}

/** `bandBlend` of every band, in → out, for the camera's current distance. */
export function tierBlends(cam: Camera): number[] {
  const dist = distanceLy(cam);
  return TIER_BANDS.map(band => bandBlend(band, dist));
}

/** The system ↔ star cross-fade, 0 (system layer only) … 1 (star layer only). */
export function tierBlend(cam: Camera): number {
  return bandBlend(TIER_BANDS[0]!, distanceLy(cam));
}

/** How strongly each layer draws at a given `tierBlend` (all in [0, 1]). */
export interface LayerWeights {
  /** Planets, moons, rings and orbit lines of the system layer. */
  bodies: number;
  /** The focused star's sphere (and glare). */
  focusedSphere: number;
  /** The focused star's sprite, which takes over from its sphere. */
  focusedSprite: number;
  /** Every other star sprite. */
  stars: number;
}

/**
 * Layer weights across the cross-fade: bodies fade out and neighbour stars fade
 * in over the whole band, while the focused star hands over from sphere to
 * sprite only at its outer end (from `STAR_HANDOFF_START`), so it is drawn
 * exactly once at full strength throughout.
 */
export function layerWeights(blend: number): LayerWeights {
  const handoff = smoothstep(STAR_HANDOFF_START, 1, blend);
  return { bodies: 1 - blend, focusedSphere: 1 - handoff, focusedSprite: handoff, stars: blend };
}
