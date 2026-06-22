import { clamp } from '@pierre/ecs/modules/math';

import {
  LY_PER_SECTOR,
  PLANET_DISC_BASE_AU,
  PLANET_DISC_MAX_AU,
  PLANET_DISC_MIN_AU,
  PLANET_DISC_PER_DECADE_AU,
  STAR_DISC_BASE_AU,
  STAR_DISC_MAX_AU,
  STAR_DISC_MIN_AU,
  STAR_DISC_PER_DECADE_AU,
} from './config';
import { AU_PER_LY } from './generation/units';

/**
 * The world's spatial scale. The world unit is the **astronomical unit (AU)**:
 * planet orbits are a few-to-tens of AU while stars are light-years apart, the
 * ~10⁵× ratio that makes space feel real (research §2.1). The tunable knobs
 * (light-years per sector, disc sizing) live in `config.ts`; this module
 * derives the world scale and the non-physical visual-disc mapping from them.
 * A star's physical radius is a rounding error here (the Sun is ~0.005 AU), so
 * the drawn disc is a deliberately exaggerated, clamped function of it.
 */

/** Sector edge length, in AU (the world unit), derived from `LY_PER_SECTOR`. */
export const SECTOR_SIZE = LY_PER_SECTOR * AU_PER_LY;

/** Non-physical drawn star-disc radius (AU) from a physical radius (R☉). */
export function starVisualRadius(radiusSolar: number): number {
  return clamp(
    STAR_DISC_BASE_AU + STAR_DISC_PER_DECADE_AU * Math.log10(radiusSolar),
    STAR_DISC_MIN_AU,
    STAR_DISC_MAX_AU,
  );
}

/** Non-physical drawn planet-disc radius (AU) from a physical radius (R⊕). */
export function planetVisualRadius(radiusEarth: number): number {
  return clamp(
    PLANET_DISC_BASE_AU + PLANET_DISC_PER_DECADE_AU * Math.log10(radiusEarth),
    PLANET_DISC_MIN_AU,
    PLANET_DISC_MAX_AU,
  );
}
