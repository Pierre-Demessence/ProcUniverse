import { clamp } from '@pierre/ecs/modules/math';

import { AU_PER_LY } from './generation/units';

/**
 * The single source of truth for the world's spatial scale. The world unit is
 * the **astronomical unit (AU)**: planet orbits are a few-to-tens of AU, while
 * stars are light-years apart, giving the ~10⁵× ratio that makes space feel
 * real (research §2.1). Interstellar distance lives in `LY_PER_SECTOR`; the
 * floating origin keeps rendered magnitudes small enough for float64 precision.
 */

/** Light-years spanned by one sector edge — the one stellar-density knob. */
export const LY_PER_SECTOR = 6;

/** Sector edge length, in AU (the world unit). */
export const SECTOR_SIZE = LY_PER_SECTOR * AU_PER_LY;

// A star's physical radius is a rounding error at AU scale (the Sun is
// ~0.005 AU), so the drawn disc must be deliberately non-physical to stay
// visible among AU-scale orbits (research §2.3). `visualRadius` is *render*
// data, never used for physics: a gentle log mapping of solar radii to an AU
// disc, clamped so dwarfs stay visible and giants do not swallow the system.
const STAR_VIS_BASE_AU = 0.16;
const STAR_VIS_PER_DECADE_AU = 0.09;
const STAR_VIS_MIN_AU = 0.05;
const STAR_VIS_MAX_AU = 0.7;

/** Non-physical drawn star-disc radius (AU) from a physical radius (R☉). */
export function starVisualRadius(radiusSolar: number): number {
  return clamp(
    STAR_VIS_BASE_AU + STAR_VIS_PER_DECADE_AU * Math.log10(radiusSolar),
    STAR_VIS_MIN_AU,
    STAR_VIS_MAX_AU,
  );
}

// Planets get the same non-physical treatment (an Earth is ~4e-5 AU). The disc
// stays smaller than a star's and than the orbit gaps, but a gas giant still
// reads as visibly larger than a rocky world.
const PLANET_VIS_BASE_AU = 0.05;
const PLANET_VIS_PER_DECADE_AU = 0.045;
const PLANET_VIS_MIN_AU = 0.02;
const PLANET_VIS_MAX_AU = 0.18;

/** Non-physical drawn planet-disc radius (AU) from a physical radius (R⊕). */
export function planetVisualRadius(radiusEarth: number): number {
  return clamp(
    PLANET_VIS_BASE_AU + PLANET_VIS_PER_DECADE_AU * Math.log10(radiusEarth),
    PLANET_VIS_MIN_AU,
    PLANET_VIS_MAX_AU,
  );
}
