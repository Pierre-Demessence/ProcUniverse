import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';
import { lerp } from '@pierre/ecs/modules/math';

/** Broad planet classes, from small rocky worlds to gas giants. */
export type PlanetType = 'gas-giant' | 'ice-giant' | 'rocky' | 'super-earth';

/** Phase state of surface water inferred from equilibrium temperature. */
export type WaterState = 'ice' | 'liquid' | 'vapour';

/**
 * Derived physical state of a planet, computed once from the seed and cached.
 * Masses/radii are in Earth units; temperature in kelvin; density in g/cm³.
 * Everything follows from the sampled mass plus the planet's distance from a
 * star of known luminosity (research §5.3–5.4).
 */
export interface PlanetPhysical {
  density: number;
  equilibriumTemp: number;
  inHabitableZone: boolean;
  mass: number;
  radius: number;
  type: PlanetType;
  waterState: WaterState;
}

export const PlanetPhysicalDef: ComponentDef<PlanetPhysical> = simpleComponent<PlanetPhysical>('planetPhysical', {
  density: 'number',
  equilibriumTemp: 'number',
  inHabitableZone: 'boolean',
  mass: 'number',
  radius: 'number',
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
 * Sample a planet mass (M⊕). Inside the frost line only rocky/super-Earth
 * masses form; beyond it, volatiles let bodies grow into ice and gas giants, so
 * the distribution is wider and skewed toward larger masses. One `rng()` draw.
 */
function samplePlanetMass(rng: RandomFn, beyondFrostLine: boolean): number {
  const u = rng();
  if (beyondFrostLine)
    return 10 ** lerp(Math.log10(0.3), Math.log10(3000), u ** 0.7);
  return 10 ** lerp(Math.log10(0.05), Math.log10(12), u);
}

/**
 * Derive a planet's full physical state from one seeded mass draw, given its
 * host star's luminosity (L☉) and its semi-major axis (AU). Pure and
 * deterministic for a given `rng` stream position.
 */
export function samplePlanet(rng: RandomFn, luminositySolar: number, a: number): PlanetPhysical {
  const beyond = a >= frostLine(luminositySolar);
  const mass = samplePlanetMass(rng, beyond);
  const type = classifyType(mass, beyond);
  const radius = massToRadius(mass);
  const temperature = equilibriumTemp(luminositySolar, a, albedoFor(type));
  const hz = habitableZone(luminositySolar);
  return {
    density: (EARTH_DENSITY * mass) / radius ** 3,
    equilibriumTemp: temperature,
    inHabitableZone: a >= hz.inner && a <= hz.outer,
    mass,
    radius,
    type,
    waterState: waterStateFor(temperature),
  };
}
