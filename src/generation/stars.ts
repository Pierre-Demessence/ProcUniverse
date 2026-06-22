import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';

import { POP_BIAS } from '../config';
import { blackbodyColor } from './blackbody';
import { T_SUN } from './units';

/** Morgan–Keenan spectral classes, hottest (O) to coolest (M). */
export type SpectralClass = 'A' | 'B' | 'F' | 'G' | 'K' | 'M' | 'O';

/**
 * The derived physical state of a main-sequence star. Everything here is a
 * one-time pure function of the star's sampled **mass** (the single degree of
 * freedom), computed once at generation and cached — never per frame. Units:
 * solar masses/radii/luminosities, kelvin, and years.
 */
export interface StarPhysical {
  /** sRGB hex colour from the blackbody curve at `temperature`. */
  colorHex: string;
  /** Main-sequence lifetime, in years (∝ M/L). */
  lifetime: number;
  /** Bolometric luminosity, in solar luminosities (L☉). */
  luminosity: number;
  /** Mass, in solar masses (M☉). */
  mass: number;
  /** Radius, in solar radii (R☉). */
  radius: number;
  /** Morgan–Keenan class, binned from `temperature`. */
  spectralClass: SpectralClass;
  /** Effective surface temperature, in kelvin. */
  temperature: number;
}

export const StarPhysicalDef: ComponentDef<StarPhysical> = simpleComponent<StarPhysical>('starPhysical', {
  colorHex: 'string',
  lifetime: 'number',
  luminosity: 'number',
  mass: 'number',
  radius: 'number',
  spectralClass: 'string',
  temperature: 'number',
});

// Kroupa (2001) Initial Mass Function: dN/dM ∝ M^(−α), a broken power law.
// Low-mass stars dominate (~76% of the [0.08, 0.5] segment), so the field
// skews heavily toward M dwarfs, as observed (research §4.1). Clamped to a
// playable [0.08, 50] M☉ range.
const IMF_MIN_MASS = 0.08;
const IMF_BREAK_MASS = 0.5;
const IMF_MAX_MASS = 50;
const IMF_ALPHA_LOW = 1.3; // 0.08–0.5 M☉
const IMF_ALPHA_HIGH = 2.3; // 0.5–50 M☉

// Per-segment coefficients of M^(−α). Fixing the low segment at 1, the high
// segment is scaled so the density is continuous at the break mass.
const IMF_COEF_LOW = 1;
const IMF_COEF_HIGH = IMF_BREAK_MASS ** (IMF_ALPHA_HIGH - IMF_ALPHA_LOW);

/** Definite integral of `coef · M^(−alpha)` over `[lo, hi]` (alpha ≠ 1). */
function powerLawIntegral(lo: number, hi: number, alpha: number, coef: number): number {
  const exp = 1 - alpha;
  return (coef * (hi ** exp - lo ** exp)) / exp;
}

/** Mass `M` at which the partial integral from `lo` equals `area` (alpha ≠ 1). */
function powerLawInverse(lo: number, alpha: number, coef: number, area: number): number {
  const exp = 1 - alpha;
  return (lo ** exp + (area * exp) / coef) ** (1 / exp);
}

const IMF_AREA_LOW = powerLawIntegral(IMF_MIN_MASS, IMF_BREAK_MASS, IMF_ALPHA_LOW, IMF_COEF_LOW);
const IMF_AREA_HIGH = powerLawIntegral(IMF_BREAK_MASS, IMF_MAX_MASS, IMF_ALPHA_HIGH, IMF_COEF_HIGH);
const IMF_AREA_TOTAL = IMF_AREA_LOW + IMF_AREA_HIGH;

/**
 * Sample a stellar mass (M☉) from the Kroupa IMF by inverse-CDF: pick a point
 * in the total probability area, then invert whichever power-law segment it
 * falls in. Consumes exactly one `rng()` draw.
 *
 * `activity` ∈ [0, 1] biases the draw by galactic stellar population: a
 * star-forming value near 1 (spiral arms) warps it toward high-mass, hot, blue
 * stars; a quiescent value near 0 (old cores, ellipticals) toward low-mass,
 * cool, red ones; 0.5 (the default) is the unbiased IMF.
 */
export function sampleStellarMass(rng: RandomFn, activity = 0.5): number {
  // Warp the uniform draw by a population gamma: <1 lifts it toward the rare
  // high-mass tail (young/blue), >1 pushes it toward low mass (old/red); the
  // 0.5 midpoint gives gamma = 1, i.e. the unbiased IMF.
  const gamma = Math.exp(POP_BIAS * (0.5 - activity) * 2);
  const area = rng() ** gamma * IMF_AREA_TOTAL;
  if (area < IMF_AREA_LOW)
    return powerLawInverse(IMF_MIN_MASS, IMF_ALPHA_LOW, IMF_COEF_LOW, area);
  return powerLawInverse(IMF_BREAK_MASS, IMF_ALPHA_HIGH, IMF_COEF_HIGH, area - IMF_AREA_LOW);
}

/**
 * Main-sequence luminosity (L☉) from mass (M☉) — the piecewise mass–luminosity
 * relation (research §4.2). Steep: a 10 M☉ star is ~10⁴× the Sun.
 */
export function luminosityFromMass(mass: number): number {
  if (mass < 0.43)
    return 0.23 * mass ** 2.3;
  if (mass < 2)
    return mass ** 4;
  if (mass < 55)
    return 1.4 * mass ** 3.5;
  return 32000 * mass;
}

/** Main-sequence radius (R☉) from mass (M☉), approximate (research §4.2). */
export function radiusFromMass(mass: number): number {
  return mass <= 1 ? mass ** 0.8 : mass ** 0.57;
}

/**
 * Effective temperature (K) from luminosity and radius via Stefan–Boltzmann
 * (`L = 4πR²σT⁴`). In solar units the constants cancel to
 * `T = T☉ · L^(1/4) · R^(−1/2)`.
 */
export function temperatureFromLuminosityRadius(luminosity: number, radius: number): number {
  return T_SUN * luminosity ** 0.25 / radius ** 0.5;
}

/**
 * Main-sequence lifetime (years) ≈ 10 Gyr · (M / L): nuclear fuel scales with
 * mass, burn rate with luminosity. Massive stars are short-lived; M dwarfs
 * outlast the present age of the universe.
 */
export function lifetimeFromMassLuminosity(mass: number, luminosity: number): number {
  return 1e10 * (mass / luminosity);
}

/** Bin an effective temperature (K) into its Morgan–Keenan spectral class. */
export function spectralClassFromTemperature(tempK: number): SpectralClass {
  if (tempK >= 33000)
    return 'O';
  if (tempK >= 10000)
    return 'B';
  if (tempK >= 7300)
    return 'A';
  if (tempK >= 6000)
    return 'F';
  if (tempK >= 5300)
    return 'G';
  if (tempK >= 3900)
    return 'K';
  return 'M';
}

/**
 * Derive a star's full physical state from one seeded mass draw: sample the
 * mass from the IMF (optionally `activity`-biased by stellar population), then
 * chain mass → luminosity, radius, temperature, colour, spectral class, and
 * lifetime. Pure and deterministic for a given `rng` stream position.
 */
export function sampleStar(rng: RandomFn, activity = 0.5): StarPhysical {
  const mass = sampleStellarMass(rng, activity);
  const luminosity = luminosityFromMass(mass);
  const radius = radiusFromMass(mass);
  const temperature = temperatureFromLuminosityRadius(luminosity, radius);
  return {
    colorHex: blackbodyColor(temperature),
    lifetime: lifetimeFromMassLuminosity(mass, luminosity),
    luminosity,
    mass,
    radius,
    spectralClass: spectralClassFromTemperature(temperature),
    temperature,
  };
}
