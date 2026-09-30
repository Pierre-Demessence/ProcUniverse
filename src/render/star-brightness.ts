/**
 * Apparent brightness of a star-tier sprite, from the star's luminosity and its
 * distance to the camera — the same inverse-square law that makes a real sky a
 * few bright stars over many faint ones — mapped onto a clamped
 * magnitude-like (log flux) scale so every star stays visible.
 */

import {
  STAR_BRIGHTNESS_GAMMA,
  STAR_LOG_FLUX_BRIGHT,
  STAR_LOG_FLUX_FAINT,
  STAR_SATURATION_BOOST,
  STAR_SPRITE_MAX_PX,
  STAR_SPRITE_MIN_INTENSITY,
  STAR_SPRITE_MIN_PX,
  STAR_SPRITE_PEAK_INTENSITY,
} from '../config/render';
import { AU_PER_LY } from '../generation/units';

/**
 * Normalised apparent brightness in [0, 1]: log10 of the flux (L☉ / ly²) placed
 * between `STAR_LOG_FLUX_FAINT` (0) and `STAR_LOG_FLUX_BRIGHT` (1).
 */
export function apparentStarLevel(luminosity: number, distanceAu: number): number {
  const distanceLy = Math.max(distanceAu, 1e-6) / AU_PER_LY;
  const logFlux = Math.log10(Math.max(luminosity, 1e-12) / (distanceLy * distanceLy));
  const t = (logFlux - STAR_LOG_FLUX_FAINT) / (STAR_LOG_FLUX_BRIGHT - STAR_LOG_FLUX_FAINT);
  return Math.min(1, Math.max(0, t));
}

/** Colour multiplier for a sprite at `level`; the top end exceeds the bloom threshold. */
export function starSpriteIntensity(level: number): number {
  return STAR_SPRITE_MIN_INTENSITY + (STAR_SPRITE_PEAK_INTENSITY - STAR_SPRITE_MIN_INTENSITY) * level ** STAR_BRIGHTNESS_GAMMA;
}

/** On-screen sprite diameter (px) at `level`: brighter stars read gently larger. */
export function starSpriteSizePx(level: number): number {
  return STAR_SPRITE_MIN_PX + (STAR_SPRITE_MAX_PX - STAR_SPRITE_MIN_PX) * level;
}

/**
 * Push an sRGB colour away from its grey by `STAR_SATURATION_BOOST` (clamped to
 * [0, 1]), so pale blackbody tints read as orange / white / blue. Writes `out`.
 */
export function boostSaturation(r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  const grey = (r + g + b) / 3;
  out[0] = Math.min(1, Math.max(0, grey + (r - grey) * STAR_SATURATION_BOOST));
  out[1] = Math.min(1, Math.max(0, grey + (g - grey) * STAR_SATURATION_BOOST));
  out[2] = Math.min(1, Math.max(0, grey + (b - grey) * STAR_SATURATION_BOOST));
  return out;
}
