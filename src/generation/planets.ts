import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';
import { lerp } from '@pierre/ecs/modules/math';

import { SECONDS_PER_YEAR } from './units';

/** Broad planet classes, from small rocky worlds to gas giants. */
export type PlanetType = 'gas-giant' | 'ice-giant' | 'rocky' | 'super-earth';

/** Phase state of surface water inferred from equilibrium temperature. */
export type WaterState = 'ice' | 'liquid' | 'vapour';

/**
 * Derived physical state of a planet, computed once from the seed and cached.
 * Masses/radii are in Earth units; temperature in kelvin; density in g/cm³;
 * rotation in hours; obliquity in degrees. Mass is the primary draw (everything
 * chemical and thermal follows from it plus the host star's luminosity); rotation,
 * axial tilt, moon richness, and rings are four further draws (research §5.3–5.4).
 */
export interface PlanetPhysical {
  density: number;
  equilibriumTemp: number;
  hasRings: boolean;
  inHabitableZone: boolean;
  insolation: number;
  mass: number;
  moonRichness: number;
  obliquity: number;
  radius: number;
  rotationPeriod: number;
  tidallyLocked: boolean;
  type: PlanetType;
  waterState: WaterState;
}

export const PlanetPhysicalDef: ComponentDef<PlanetPhysical> = simpleComponent<PlanetPhysical>('planetPhysical', {
  density: 'number',
  equilibriumTemp: 'number',
  hasRings: 'boolean',
  inHabitableZone: 'boolean',
  insolation: 'number',
  mass: 'number',
  moonRichness: 'number',
  obliquity: 'number',
  radius: 'number',
  rotationPeriod: 'number',
  tidallyLocked: 'boolean',
  type: 'string',
  waterState: 'string',
});

// Earth's mean density (g/cm³); other densities scale as mass / radius³.
const EARTH_DENSITY = 5.514;
// Planetary equilibrium-temperature constant (Catling & Kasting 2017): the
// temperature of a zero-albedo body at 1 AU around the Sun, ×(L/a²)^¼.
const TEQ_CONSTANT = 278.3;
// Forecaster (Chen & Kipping 2017) mass–radius break masses, in Earth masses.
const TERRAN_MAX = 2.04;
const NEPTUNIAN_MAX = 131.6;
// Earth's surface escape velocity (km/s); other planets scale as √(M/R).
const EARTH_ESCAPE_VELOCITY = 11.186;
// Earth's central pressure (GPa). The uniform-sphere bound 3GM²/8πR⁴ scales as
// M²/R⁴; the coefficient is anchored to Earth's measured ~364 GPa rather than the
// bound's own ~170 GPa underestimate, so Earth reads true and others scale from it.
const EARTH_CENTRAL_PRESSURE_GPA = 364;
// Earth's equilibrium (pre-greenhouse) temperature (K) — the ESI reference, so
// bodies are compared on the same footing as our other equilibrium temperatures.
const EARTH_EQUILIBRIUM_TEMP = 255;
// Earth Similarity Index weights (Schulze-Makuch et al. 2011) over its four
// parameters — radius, density, escape velocity, temperature — and that count.
const ESI_WEIGHT_RADIUS = 0.57;
const ESI_WEIGHT_DENSITY = 1.07;
const ESI_WEIGHT_ESCAPE = 0.7;
const ESI_WEIGHT_TEMP = 5.58;
const ESI_PARAM_COUNT = 4;
// Tidal-locking timescale coefficient (years): calibrated so Earth's is ~10¹³ yr
// (never locks) while a close-in planet around an M dwarf locks within ~1 Gyr.
const TIDAL_LOCK_CONSTANT_YEARS = 1e13;
// Hours in a year, for expressing a tidally-locked planet's spin as its year.
const HOURS_PER_YEAR = SECONDS_PER_YEAR / 3600;
// Oblateness: Earth's radius (m) and surface gravity (m/s²), with a structure
// factor tuned so the rotational flattening matches the giant planets.
const EARTH_RADIUS_M = 6.371e6;
const EARTH_SURFACE_GRAVITY_MS2 = 9.81;
const OBLATENESS_FACTOR = 0.75;
const TAU = Math.PI * 2;
// Cosmic-shoreline threshold (Zahnle & Catling 2017): a body keeps an atmosphere
// when v_esc⁴ / insolation exceeds this — calibrated so Mercury/Moon are bare
// while Mars/Earth/Venus retain theirs.
const COSMIC_SHORELINE_THRESHOLD = 400;
// Greenhouse warming (K) for an Earth-like atmosphere at Earth's equilibrium
// temperature, growing with temperature toward a Venus-like runaway.
const GREENHOUSE_K = 33;
// Planet-metallicity correlation (Fischer & Valenti 2005): metal-rich systems
// form more massive planets. Warps the mass draw toward high mass as [Fe/H] rises.
const METALLICITY_MASS_BIAS = 1;

/** Snow line in AU: beyond it volatiles condense and giants tend to form. */
export function frostLine(luminositySolar: number): number {
  return 2.7 * Math.sqrt(luminositySolar);
}

/** Conservative habitable-zone bounds in AU (Kopparapu 2013), scaling as √L. */
export function habitableZone(luminositySolar: number): { inner: number; outer: number } {
  const root = Math.sqrt(luminositySolar);
  return { inner: 0.95 * root, outer: 1.37 * root };
}

/**
 * Equilibrium temperature (K) from stellar luminosity (L☉), orbital distance
 * (AU) and bond albedo, via the Stefan–Boltzmann energy balance.
 */
export function equilibriumTemp(luminositySolar: number, a: number, albedo: number): number {
  return TEQ_CONSTANT * (1 - albedo) ** 0.25 * (luminositySolar / a ** 2) ** 0.25;
}

/**
 * Radius (R⊕) from mass (M⊕) — the Forecaster broken power law. Rocky worlds
 * grow with mass; Neptunian bodies grow faster; Jovian radius is ~flat (added
 * mass is offset by gravitational compression). Anchored so 1 M⊕ → 1 R⊕.
 */
export function massToRadius(massEarth: number): number {
  if (massEarth < TERRAN_MAX)
    return massEarth ** 0.279;
  const terranBreak = TERRAN_MAX ** 0.279;
  if (massEarth < NEPTUNIAN_MAX)
    return terranBreak * (massEarth / TERRAN_MAX) ** 0.589;
  const neptunianBreak = terranBreak * (NEPTUNIAN_MAX / TERRAN_MAX) ** 0.589;
  return neptunianBreak * (massEarth / NEPTUNIAN_MAX) ** -0.044;
}

/** Classify a planet from its mass and whether it formed beyond the frost line. */
export function classifyType(massEarth: number, beyondFrostLine: boolean): PlanetType {
  if (massEarth >= 50)
    return 'gas-giant';
  if (beyondFrostLine && massEarth >= 8)
    return 'ice-giant';
  if (massEarth >= 2)
    return 'super-earth';
  return 'rocky';
}

function albedoFor(type: PlanetType): number {
  return type === 'gas-giant' || type === 'ice-giant' ? 0.5 : 0.3;
}

function waterStateFor(tempK: number): WaterState {
  if (tempK < 273)
    return 'ice';
  if (tempK < 373)
    return 'liquid';
  return 'vapour';
}

/**
 * Sample a planet mass (M⊕). Inside the frost line only rocky/super-Earth masses
 * form; beyond it, volatiles let bodies grow into ice and gas giants. A higher
 * stellar `metallicity` warps the draw toward more massive planets (Fischer &
 * Valenti 2005). One `rng()` draw.
 */
function samplePlanetMass(rng: RandomFn, beyondFrostLine: boolean, metallicity: number): number {
  const warped = rng() ** Math.exp(-METALLICITY_MASS_BIAS * metallicity);
  if (beyondFrostLine)
    return 10 ** lerp(Math.log10(0.3), Math.log10(3000), warped ** 0.7);
  return 10 ** lerp(Math.log10(0.05), Math.log10(12), warped);
}

/**
 * Sample a sidereal rotation period (hours). Giants spin fast (~8–18 h);
 * terrestrials span hours to months, log-uniform. One `rng()` draw.
 */
function sampleRotationPeriod(rng: RandomFn, type: PlanetType): number {
  if (type === 'gas-giant' || type === 'ice-giant')
    return lerp(8, 18, rng());
  return 10 ** lerp(Math.log10(8), Math.log10(2000), rng());
}

/**
 * Tidal-locking timescale (years): `∝ a⁶·M_p / (M_star²·R_p³)` (Gladman et al.
 * 1996 form), calibrated so Earth's is ~10¹³ yr. Compared against the star's age
 * to decide whether the planet is spin-locked.
 */
function tidalLockTimescale(a: number, massEarth: number, starMassSolar: number, radiusEarth: number): number {
  return (TIDAL_LOCK_CONSTANT_YEARS * a ** 6 * massEarth) / (starMassSolar ** 2 * radiusEarth ** 3);
}

/**
 * Derive a planet's full physical state, given its host star's luminosity (L☉),
 * mass (M☉), age (years), and metallicity ([Fe/H]), and the planet's semi-major
 * axis (AU). Mass is the primary draw (everything chemical and thermal chains
 * from it, biased toward giants in metal-rich systems); four further appended
 * draws give rotation, axial tilt, moon richness, and a ring flag. A planet whose
 * tidal-locking time is shorter than the star's age is spin-locked, so its
 * rotation period becomes its orbital period. Consumes five draws.
 */
export function samplePlanet(rng: RandomFn, luminositySolar: number, a: number, starMassSolar: number, starAgeYears: number, starMetallicity = 0): PlanetPhysical {
  const beyond = a >= frostLine(luminositySolar);
  const mass = samplePlanetMass(rng, beyond, starMetallicity);
  const type = classifyType(mass, beyond);
  const radius = massToRadius(mass);
  const temperature = equilibriumTemp(luminositySolar, a, albedoFor(type));
  const hz = habitableZone(luminositySolar);
  const naturalRotation = sampleRotationPeriod(rng, type);
  const obliquity = rng() * 180;
  // A per-planet formation-luck trait in [0, 1) feeding the moon model (see
  // moons.ts): kept as this planet's fourth draw so the stream is unchanged.
  const moonRichness = rng();
  const hasRings = rng() < (type === 'gas-giant' ? 0.5 : type === 'ice-giant' ? 0.4 : 0.05);
  const tidallyLocked = tidalLockTimescale(a, mass, starMassSolar, radius) < starAgeYears;
  const orbitalPeriodYears = Math.sqrt(a ** 3 / starMassSolar);
  return {
    density: (EARTH_DENSITY * mass) / radius ** 3,
    equilibriumTemp: temperature,
    hasRings,
    inHabitableZone: a >= hz.inner && a <= hz.outer,
    insolation: luminositySolar / a ** 2,
    mass,
    moonRichness,
    obliquity,
    radius,
    rotationPeriod: tidallyLocked ? orbitalPeriodYears * HOURS_PER_YEAR : naturalRotation,
    tidallyLocked,
    type,
    waterState: waterStateFor(temperature),
  };
}

/** Surface gravity in Earth gravities (g⊕ = 1): `M / R²` in Earth units. */
export function surfaceGravity(massEarth: number, radiusEarth: number): number {
  return massEarth / radiusEarth ** 2;
}

/** Surface escape velocity (km/s), `√(M/R)` in Earth units (Earth = 11.19 km/s). */
export function escapeVelocity(massEarth: number, radiusEarth: number): number {
  return EARTH_ESCAPE_VELOCITY * Math.sqrt(massEarth / radiusEarth);
}

/**
 * Approximate central pressure (GPa). The uniform-sphere bound `3GM²/8πR⁴` scales
 * as `M²/R⁴`; the coefficient is anchored to Earth's real ~364 GPa so Earth reads
 * true and others scale from it. Indicative only — real interiors are centrally
 * condensed and follow their own equation of state.
 */
export function centralPressure(massEarth: number, radiusEarth: number): number {
  return (EARTH_CENTRAL_PRESSURE_GPA * massEarth ** 2) / radiusEarth ** 4;
}

/**
 * A coarse bulk-composition label. Giants are gaseous/icy by class; smaller
 * worlds are split by mean density, which tracks the iron / rock / water / gas
 * mix (research §3.1).
 */
export function compositionClass(type: PlanetType, density: number): string {
  if (type === 'gas-giant')
    return 'Gaseous (H/He)';
  if (type === 'ice-giant')
    return 'Icy (H/He, ices)';
  if (density >= 6)
    return 'Iron-rich';
  if (density >= 3.5)
    return 'Rocky';
  if (density >= 1.5)
    return 'Water / ice';
  return 'Volatile-rich';
}

/**
 * Earth Similarity Index in [0, 1] (Schulze-Makuch et al. 2011): a weighted
 * geometric mean of how close radius, density, escape velocity, and temperature
 * are to Earth's (1 = Earth-identical). Uses equilibrium temperature so bodies
 * are compared before any greenhouse effect, like our other temperatures.
 */
export function earthSimilarityIndex(
  radiusEarth: number,
  density: number,
  escapeVelocityKms: number,
  equilibriumTempK: number,
): number {
  const similarity = (x: number, ref: number, weight: number): number =>
    (1 - Math.abs((x - ref) / (x + ref))) ** (weight / ESI_PARAM_COUNT);
  return (
    similarity(radiusEarth, 1, ESI_WEIGHT_RADIUS)
    * similarity(density, EARTH_DENSITY, ESI_WEIGHT_DENSITY)
    * similarity(escapeVelocityKms, EARTH_ESCAPE_VELOCITY, ESI_WEIGHT_ESCAPE)
    * similarity(equilibriumTempK, EARTH_EQUILIBRIUM_TEMP, ESI_WEIGHT_TEMP)
  );
}

/**
 * Rotational flattening `f = (R_eq − R_pol)/R_eq` — how oblate ("non-round") a
 * planet is from its spin: `≈ k·ω²R/g`, with a structure factor `k` tuned to the
 * giant planets (Jupiter ≈ 0.065, Saturn ≈ 0.10, Earth ≈ 0.003). Needs the
 * sidereal rotation period (hours).
 */
export function oblateness(rotationPeriodHours: number, massEarth: number, radiusEarth: number): number {
  const omega = TAU / (rotationPeriodHours * 3600);
  const radiusM = radiusEarth * EARTH_RADIUS_M;
  const gravity = (massEarth / radiusEarth ** 2) * EARTH_SURFACE_GRAVITY_MS2;
  return (OBLATENESS_FACTOR * omega ** 2 * radiusM) / gravity;
}

/**
 * Whether a planet retains a substantial atmosphere — the "cosmic shoreline":
 * retention scales as `v_esc⁴` against the cumulative stellar (XUV) insolation
 * (Zahnle & Catling 2017). High gravity and low irradiation keep an atmosphere.
 */
export function retainsAtmosphere(escapeVelocityKms: number, insolation: number): boolean {
  return escapeVelocityKms ** 4 / insolation > COSMIC_SHORELINE_THRESHOLD;
}

/**
 * A coarse atmosphere-composition label from planet type and temperature: giants
 * are H/He(+ices), warm rocky worlds run to CO₂, temperate ones to N₂/CO₂, cold
 * ones to a thin N₂ — or "None" for a body below the cosmic shoreline.
 */
export function atmosphereType(type: PlanetType, hasAtmosphere: boolean, equilibriumTempK: number): string {
  if (!hasAtmosphere)
    return 'None';
  if (type === 'gas-giant')
    return 'Hydrogen / helium';
  if (type === 'ice-giant')
    return 'H/He + methane';
  if (equilibriumTempK > 600)
    return 'CO₂ (runaway)';
  if (equilibriumTempK > 250)
    return 'N₂ / CO₂';
  return 'Thin N₂';
}

/**
 * Greenhouse-corrected surface temperature (K): the equilibrium temperature plus
 * a warming that grows with temperature for a rocky world with an atmosphere
 * (Earth ≈ +33 K; hotter worlds trend toward a Venus-like runaway). Airless or
 * giant bodies report their equilibrium temperature unchanged. Approximate.
 */
export function surfaceTemperature(equilibriumTempK: number, type: PlanetType, hasAtmosphere: boolean): number {
  if (!hasAtmosphere || type === 'gas-giant' || type === 'ice-giant')
    return equilibriumTempK;
  return equilibriumTempK + GREENHOUSE_K * (equilibriumTempK / EARTH_EQUILIBRIUM_TEMP) ** 2;
}
