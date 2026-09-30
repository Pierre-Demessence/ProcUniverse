import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { DISK_OUTER_MAX_AU } from '../config/data';
import { GALAXY_FIELD_SECTORS, GALAXY_TIER_SECTORS, STAR_BLEND_MAX_AU, STAR_BLEND_MIN_AU, STAR_HANDOFF_START, STAR_TILT_EASE_START_SECTORS, SYSTEM_TIER_MAX_AU, TIER_HYSTERESIS, UNIVERSE_SECTORS } from '../config/render';
import { SECTOR_SIZE } from '../scale';

/**
 * Level-of-detail tier. The representation switches with zoom so the on-screen
 * draw count stays bounded regardless of how many bodies exist (in → out):
 * - `system`: full systems (star + planets + orbits), streamed as ECS entities.
 * - `star`: each system is a single bloomed sprite in a 3D neighbourhood.
 * - `galaxy`: one galaxy's per-aggregate-cell density glow.
 * - `galaxy-field`: each galaxy a discrete tinted sprite + label.
 * - `universe`: the cosmic-scale aggregate glow.
 */
export type Tier = 'galaxy' | 'galaxy-field' | 'star' | 'system' | 'universe';

export interface SectorRange {
  maxSx: number;
  maxSy: number;
  minSx: number;
  minSy: number;
}

/**
 * Reach (AU) of the focused system's bodies around its star — the widest planet
 * disk with room for eccentric orbits and moons, and far below the spacing of
 * neighbouring stars. In the cross-fade band, bodies beyond it belong to
 * neighbouring systems, which are drawn as sprites instead.
 */
export const SYSTEM_LAYER_REACH_AU = DISK_OUTER_MAX_AU * 4;

// The system→star boundary is configured in AU (a realistic system is a
// vanishing fraction of a sector) and converted to sectors-across here.
const STAR_AT = SYSTEM_TIER_MAX_AU / SECTOR_SIZE;

/**
 * Sector span of the larger viewport axis at the current zoom. Selecting the
 * tier from the larger axis bounds the visible-sector count on BOTH axes
 * regardless of the viewport's aspect ratio.
 */
export function sectorsAcross(cam: Camera): number {
  return (Math.max(cam.viewportW, cam.viewportH) / cam.zoom) / SECTOR_SIZE;
}

// Tiers ordered by zoom (in → out); `BOUNDARIES[i]` is the sectors-across value
// separating `TIER_ORDER[i]` from the next tier out.
const TIER_ORDER = ['system', 'star', 'galaxy', 'galaxy-field', 'universe'] as const;
const BOUNDARIES = [STAR_AT, GALAXY_TIER_SECTORS, GALAXY_FIELD_SECTORS, UNIVERSE_SECTORS];

/**
 * Choose the tier from zoom, with a hysteresis dead-band around the boundaries
 * so a zoom hovering at one doesn't thrash (each crossing re-streams the view).
 */
export function selectTier(cam: Camera, prev: Tier): Tier {
  const across = sectorsAcross(cam);
  let idx = BOUNDARIES.length;
  for (let i = 0; i < BOUNDARIES.length; i++) {
    const b = BOUNDARIES[i];
    if (b !== undefined && across < b) {
      idx = i;
      break;
    }
  }
  const prevIdx = TIER_ORDER.indexOf(prev);
  const upper = BOUNDARIES[prevIdx];
  const lower = BOUNDARIES[prevIdx - 1];
  if (idx > prevIdx && upper !== undefined && across < upper * TIER_HYSTERESIS)
    idx = prevIdx;
  else if (idx < prevIdx && lower !== undefined && across > lower / TIER_HYSTERESIS)
    idx = prevIdx;
  return TIER_ORDER[idx] ?? prev;
}

/** Inclusive range of sector coordinates overlapping the camera view. */
export function visibleSectors(cam: Camera): SectorRange {
  const r = cameraViewRect(cam);
  return {
    maxSx: Math.floor((r.x + r.w) / SECTOR_SIZE),
    maxSy: Math.floor((r.y + r.h) / SECTOR_SIZE),
    minSx: Math.floor(r.x / SECTOR_SIZE),
    minSy: Math.floor(r.y / SECTOR_SIZE),
  };
}

/** Inclusive range of sector coordinates overlapping the square `(cx, cy) ± halfExtent` (absolute AU). */
export function sectorsAround(cx: number, cy: number, halfExtent: number): SectorRange {
  return {
    maxSx: Math.floor((cx + halfExtent) / SECTOR_SIZE),
    maxSy: Math.floor((cy + halfExtent) / SECTOR_SIZE),
    minSx: Math.floor((cx - halfExtent) / SECTOR_SIZE),
    minSy: Math.floor((cy - halfExtent) / SECTOR_SIZE),
  };
}

/** Hermite smooth-step of `x` from `edge0` to `edge1`, clamped to [0, 1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How far the view has cross-faded from the system layer (0) to the star layer
 * (1): a smooth-step in log zoom across `STAR_BLEND_MIN_AU`–`STAR_BLEND_MAX_AU`
 * of view span. Independent of the discrete tier, which keeps driving
 * selection, the HUD and labels.
 */
export function tierBlend(cam: Camera): number {
  const acrossAu = sectorsAcross(cam) * SECTOR_SIZE;
  return smoothstep(Math.log(STAR_BLEND_MIN_AU), Math.log(STAR_BLEND_MAX_AU), Math.log(acrossAu));
}

/**
 * Fraction of the user's tilt kept at the star tier: 1 up to
 * `STAR_TILT_EASE_START_SECTORS` across, easing (in log zoom) to 0 — top-down —
 * at the galaxy boundary, where the orthographic galaxy view takes over.
 */
export function starTierTiltScale(cam: Camera): number {
  return 1 - smoothstep(Math.log(STAR_TILT_EASE_START_SECTORS), Math.log(GALAXY_TIER_SECTORS), Math.log(sectorsAcross(cam)));
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
