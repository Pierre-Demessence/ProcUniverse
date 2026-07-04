/**
 * Pure, data-driven parameters for procedural star shading (see
 * docs/plans/star-shading.md). Kept free of any Three.js / TSL import so it is
 * cheap to unit test and reusable; the TSL material in `star-material.ts` feeds
 * these values into the shader as uniforms.
 */

/** Temperature range (K) the surface params interpolate across (cool M → hot O). */
const TEMP_COOL = 3000;
const TEMP_HOT = 10000;

/**
 * Temperature-driven surface look. Cooler stars have vigorous convection: large,
 * high-contrast granules and prominent starspots. Hotter stars have thin/absent
 * surface convection: fine, low-contrast mottling and few spots. Limb darkening
 * is a touch stronger on hotter stars.
 */
export interface StarSurfaceParams {
  /** Fractional granulation cell contrast (0 = smooth). */
  granulationContrast: number;
  /** Granulation spatial frequency: larger = finer cells. */
  granulationScale: number;
  /** Classic limb-darkening coefficient `u` in `I(μ)/I(0) = 1 − u(1 − μ)`. */
  limbDarkening: number;
  /** Fractional darkening of starspot regions (0 = none). */
  spotIntensity: number;
}

/** Clamp `x` to `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Map a star's effective temperature to its procedural surface parameters. */
export function starSurfaceParams(temperature: number): StarSurfaceParams {
  // 0 at the cool end, 1 at the hot end.
  const t = clamp((temperature - TEMP_COOL) / (TEMP_HOT - TEMP_COOL), 0, 1);
  return {
    granulationContrast: 0.18 - 0.11 * t,
    granulationScale: 4 + 6 * t,
    limbDarkening: 0.5 + 0.25 * t,
    spotIntensity: 0.25 - 0.2 * t,
  };
}

/**
 * Point-light intensity for a star of the given bolometric luminosity (L☉),
 * relative to a `base` (the Sun ≈ base). Luminosity spans many orders of
 * magnitude, so a raw factor would leave planets around dim stars black and
 * blow out bright ones; a gentle log map keeps every system readable while a
 * more luminous star still lights its planets visibly harder. Clamped to
 * `[0.6, 1.6]·base`.
 */
export function starLightIntensity(luminosity: number, base: number): number {
  const factor = 1 + 0.12 * Math.log10(Math.max(luminosity, 1e-6));
  return base * clamp(factor, 0.6, 1.6);
}
