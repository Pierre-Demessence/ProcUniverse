import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { SECTOR_SIZE } from '../generation/universe';

/**
 * Level-of-detail tier. The representation switches with zoom so the on-screen
 * draw count stays bounded regardless of how many systems exist:
 * - `system`: full systems (star + planets + orbits), streamed as ECS entities.
 * - `star`: each system is a single dot (no planets), drawn immediate-mode.
 * - `galaxy`: per-aggregate-cell density glow; individual systems are not drawn.
 */
export type Tier = 'system' | 'star' | 'galaxy';

export interface SectorRange {
  maxSx: number;
  maxSy: number;
  minSx: number;
  minSy: number;
}

// Tier thresholds, measured in sectors spanning the viewport width.
const STAR_AT = 2.2;
const GALAXY_AT = 16;

/**
 * Sector span of the larger viewport axis at the current zoom. Selecting the
 * tier from the larger axis bounds the visible-sector count on BOTH axes
 * regardless of the viewport's aspect ratio.
 */
export function sectorsAcross(cam: Camera): number {
  return (Math.max(cam.viewportW, cam.viewportH) / cam.zoom) / SECTOR_SIZE;
}

// Dead-band so a zoom hovering at a tier boundary doesn't thrash (each
// system<->star flip is a full despawn/respawn of the visible sectors).
const HYSTERESIS = 1.25;

/** Choose the tier from zoom, with hysteresis around the boundaries. */
export function selectTier(cam: Camera, prev: Tier): Tier {
  const across = sectorsAcross(cam);
  if (prev === 'system') {
    if (across > GALAXY_AT * HYSTERESIS)
      return 'galaxy';
    if (across > STAR_AT * HYSTERESIS)
      return 'star';
    return 'system';
  }
  if (prev === 'star') {
    if (across < STAR_AT / HYSTERESIS)
      return 'system';
    if (across > GALAXY_AT * HYSTERESIS)
      return 'galaxy';
    return 'star';
  }
  if (across < STAR_AT / HYSTERESIS)
    return 'system';
  if (across < GALAXY_AT / HYSTERESIS)
    return 'star';
  return 'galaxy';
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
