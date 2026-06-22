import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';
import { clamp } from '@pierre/ecs/modules/math';

import { POP_BIAS } from '../config';
import { blackbodyColor } from './blackbody';
import { T_SUN } from './units';

/** Morgan–Keenan spectral classes, hottest (O) to coolest (M). */
export type SpectralClass = 'A' | 'B' | 'F' | 'G' | 'K' | 'M' | 'O';

/**
 * The derived physical state of a main-sequence star. Mass is the primary
 * sampled degree of freedom (luminosity, radius, temperature, colour, class, and
 * lifetime all chain from it); `age` and `metallicity` are two further
 * independent draws. Computed once at generation and cached — never per frame.
 * Units: solar masses/radii/luminosities, kelvin, years, and dex for `[Fe/H]`.
 */
export interface StarPhysical {
  /** Age since formation, in years (≤ the lesser of `lifetime` and ~13.8 Gyr). */
  age: number;
  /** sRGB hex colour from the blackbody curve at `temperature`. */
  colorHex: string;
  /** Main-sequence lifetime, in years (∝ M/L). */
  lifetime: number;
  /** Bolometric luminosity, in solar luminosities (L☉). */
  luminosity: number;
  /** Mass, in solar masses (M☉). */
  mass: number;
  /** Metallicity `[Fe/H]`, in dex (0 = solar). */
  metallicity: number;
  /** Radius, in solar radii (R☉). */
  radius: number;
  /** Morgan–Keenan class, binned from `temperature`. */
  spectralClass: SpectralClass;
  /** Effective surface temperature, in kelvin. */
  temperature: number;
}

export const StarPhysicalDef: ComponentDef<StarPhysical> = simpleComponent<StarPhysical>('starPhysical', {
  age: 'number',
  colorHex: 'string',
  lifetime: 'number',
  luminosity: 'number',
  mass: 'number',
  metallicity: 'number',
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

// The age of the universe (years): the hard ceiling on any star's age. A
// low-mass star can have a main-sequence lifetime far longer than this, but the
// universe simply is not old enough for it to be older. (Phase 3: per-seed knob.)
const UNIVERSE_AGE_YEARS = 13.8e9;
// Field-star metallicity [Fe/H] (dex): centred just below solar with a modest
// spread, drawn from a normal-quantile approximation and clamped to a plausible
// range (GALAH DR3 / APOGEE DR17 disc stars).
const METALLICITY_MEAN = -0.05;
const METALLICITY_SIGMA = 0.2;
const METALLICITY_MIN = -1.5;
const METALLICITY_MAX = 0.5;

/**
 * Sample a metallicity `[Fe/H]` (dex) from one draw: map the uniform through a
 * Tukey-lambda approximation to the standard-normal quantile, then scale and
 * clamp it — a clean one-draw Gaussian-ish field-star metallicity.
 */
function sampleMetallicity(rng: RandomFn): number {
  const u = clamp(rng(), 1e-6, 1 - 1e-6);
  const z = (u ** 0.135 - (1 - u) ** 0.135) / 0.1975;
  return clamp(METALLICITY_MEAN + METALLICITY_SIGMA * z, METALLICITY_MIN, METALLICITY_MAX);
}

/**
 * Derive a star's full physical state. Mass is the primary draw (luminosity,
 * radius, temperature, colour, class, lifetime all chain from it); then two
 * further appended draws give the star's `age` — uniform up to the lesser of its
 * main-sequence lifetime and the age of the universe — and its `metallicity`.
 * Pure and deterministic for a given `rng` stream position; consumes three draws.
 */
export function sampleStar(rng: RandomFn, activity = 0.5): StarPhysical {
  const mass = sampleStellarMass(rng, activity);
  const luminosity = luminosityFromMass(mass);
  const radius = radiusFromMass(mass);
  const temperature = temperatureFromLuminosityRadius(luminosity, radius);
  const lifetime = lifetimeFromMassLuminosity(mass, luminosity);
  const age = rng() * Math.min(lifetime, UNIVERSE_AGE_YEARS);
  const metallicity = sampleMetallicity(rng);
  return {
    age,
    colorHex: blackbodyColor(temperature),
    lifetime,
    luminosity,
    mass,
    metallicity,
    radius,
    spectralClass: spectralClassFromTemperature(temperature),
    temperature,
  };
}

// Solar reference values for the derived-quantity helpers below: the Sun's
// surface gravity as log g (cgs), mean density, and surface escape velocity,
// plus the IAU 2015 bolometric-magnitude zero point and Wien's constant.
const SUN_LOG_G_CGS = 4.438;
const SUN_DENSITY = 1.408; // g/cm³
const SUN_ESCAPE_VELOCITY = 617.5; // km/s
const SOLAR_BOLOMETRIC_MAGNITUDE = 4.74; // M_bol,☉ (IAU 2015 Resolution B3)
const WIEN_CONSTANT_NM_K = 2.897772e6; // λ_max · T, in nm·K

/** Surface gravity as log g (cgs): `log g☉ + log₁₀M − 2·log₁₀R` (Sun = 4.44). */
export function surfaceGravityLog(mass: number, radius: number): number {
  return SUN_LOG_G_CGS + Math.log10(mass) - 2 * Math.log10(radius);
}

/** Mean density (g/cm³): `ρ☉·M/R³` in solar units (Sun = 1.41). */
export function meanDensity(mass: number, radius: number): number {
  return (SUN_DENSITY * mass) / radius ** 3;
}

/** Surface escape velocity (km/s): `√(M/R)` in solar units (Sun = 617.5). */
export function escapeVelocity(mass: number, radius: number): number {
  return SUN_ESCAPE_VELOCITY * Math.sqrt(mass / radius);
}

/**
 * Absolute bolometric magnitude: `M_bol,☉ − 2.5·log₁₀L`, with the IAU 2015 zero
 * point `M_bol,☉ = 4.74` (Sun = 4.74). Brighter stars are more negative.
 */
export function bolometricMagnitude(luminosity: number): number {
  return SOLAR_BOLOMETRIC_MAGNITUDE - 2.5 * Math.log10(luminosity);
}

/** Wien peak-emission wavelength (nm): `2.898×10⁶ / T` (Sun ≈ 502 nm, green). */
export function peakWavelength(temperature: number): number {
  return WIEN_CONSTANT_NM_K / temperature;
}
