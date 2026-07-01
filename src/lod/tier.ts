import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { GALAXY_FIELD_SECTORS, GALAXY_TIER_SECTORS, SYSTEM_TIER_MAX_AU, TIER_HYSTERESIS, UNIVERSE_SECTORS } from '../config/render';
import { SECTOR_SIZE } from '../scale';

/**
 * Level-of-detail tier. The representation switches with zoom so the on-screen
 * draw count stays bounded regardless of how many bodies exist (in → out):
 * - `system`: full systems (star + planets + orbits), streamed as ECS entities.
 * - `star`: each system is a single dot (no planets), drawn immediate-mode.
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
