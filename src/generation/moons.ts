import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';
import { clamp, lerp } from '@pierre/ecs/modules/math';
import { randomInt } from '@pierre/ecs/modules/rng';

import { planetVisualRadius } from '../scale';
import { nameMoon } from './naming';
import { massToRadius } from './planets';
import { EARTH_MASS_SOLAR } from './units';

/**
 * Derived physical state of a moon, in Earth units (mass M⊕, radius R⊕) with
 * density in g/cm³. Moons are small rocky/icy bodies; mass is the primary draw
 * and radius/density follow the same terran mass–radius law as small planets.
 */
export interface MoonPhysical {
  density: number;
  mass: number;
  radius: number;
  tidallyLocked: boolean;
}

export const MoonPhysicalDef: ComponentDef<MoonPhysical> = simpleComponent<MoonPhysical>('moonPhysical', {
  density: 'number',
  mass: 'number',
  radius: 'number',
  tidallyLocked: 'boolean',
});

// Earth's mean density (g/cm³); a moon's scales as mass / radius³.
const MOON_EARTH_DENSITY = 5.514;
// Major moons span roughly a lunar mass down to small icy bodies, in Earth masses
// (the Moon is 0.012 M⊕, Titan/Ganymede ~0.023–0.025 M⊕).
const MOON_MASS_MIN = 1e-4;
const MOON_MASS_MAX = 0.05;
// Major moons are almost always tidally locked to their planet (our Moon is).
const MOON_LOCK_CHANCE = 0.9;

/**
 * Sample a moon's physical state from two draws: a log-uniform mass (Earth
 * units), with radius and density from the same terran mass–radius law as small
 * planets, and a tidal-lock flag (major moons nearly always lock to their planet).
 */
export function sampleMoon(rng: RandomFn): MoonPhysical {
  const mass = 10 ** lerp(Math.log10(MOON_MASS_MIN), Math.log10(MOON_MASS_MAX), rng());
  const radius = massToRadius(mass);
  return {
    density: (MOON_EARTH_DENSITY * mass) / radius ** 3,
    mass,
    radius,
    tidallyLocked: rng() < MOON_LOCK_CHANCE,
  };
}

const TAU = Math.PI * 2;
// Moons occupy a "moon zone": from just outside the Roche limit (a few planet
// radii — any closer and tides shred a moon) out to a fraction of the planet's
// Hill radius (its gravity zone; beyond ~0.5 R_Hill the star strips moons away).
// Major (regular) moons sit in the inner part of that zone; the sparse irregular
// swarm (minor moons, modelled separately) lives farther out.
const MOON_INNER_RADII = 2.5;
const MOON_REGULAR_HILL_FRACTION = 0.15;
// Real major moons pack fairly tight (Jupiter/Saturn/Uranus adjacent moons are
// ~1.4–1.6× apart), so the outward step is drawn from a narrow ratio range.
const MOON_ORBIT_RATIO_MIN = 1.3;
const MOON_ORBIT_RATIO_MAX = 1.7;
const MOON_ECC_MAX = 0.05;
const MOON_COLORS = ['#b8b0a4', '#9aa7b3', '#c8bfa8', '#8f8f8f', '#a89684'] as const;

// Per-slot occupancy — the chance a moon has formed at a given orbit. It rises
// with planet mass (a richer circumplanetary disk fills more slots) on a log ramp
// between a rocky floor and a giant ceiling, tapers with distance (regular moons
// cluster close in), and is scaled by the planet's formation-luck trait. The moon
// COUNT is simply however many slots fill — no target and no cap; the Hill zone
// and the taper bound it.
const MOON_OCCUPANCY_MIN = 0.12;
const MOON_OCCUPANCY_MAX = 0.85;
const MOON_OCCUPANCY_MASS_LO = 1;
const MOON_OCCUPANCY_MASS_HI = 300;
const MOON_TAPER_STRENGTH = 0.7;
const MOON_RICHNESS_BIAS_MIN = 0.5;
const MOON_RICHNESS_BIAS_MAX = 1.5;
// Safety bound on the outward walk; the Hill-zone edge terminates it first (even
// the widest realistic zone fits well under this many geometric steps).
const MOON_SLOT_LIMIT = 64;

/** A generated moon: its orbit around the planet (AU) and its physical state. */
export interface MoonData {
  name: string;
  a: number;
  argPeriapsis: number;
  color: string;
  e: number;
  meanAnomaly0: number;
  physical: MoonPhysical;
  radius: number;
}

/**
 * The chance a moon has formed at an orbit sitting at Hill-fraction `f`, for a
 * planet of `massEarth` and formation-luck `richness` ∈ [0, 1). Rises with mass
 * (log ramp from a rocky floor to a giant ceiling), diminishes outward (regular
 * moons cluster close in), and is scaled by richness so two same-mass planets can
 * hold different systems. Clamped to a probability.
 */
function moonOccupancy(massEarth: number, hillFraction: number, richness: number): number {
  const massT = clamp(
    (Math.log10(massEarth) - Math.log10(MOON_OCCUPANCY_MASS_LO))
    / (Math.log10(MOON_OCCUPANCY_MASS_HI) - Math.log10(MOON_OCCUPANCY_MASS_LO)),
    0,
    1,
  );
  const base = lerp(MOON_OCCUPANCY_MIN, MOON_OCCUPANCY_MAX, massT);
  // Clamp the taper so it stays a valid weight even for a slot past the band (a
  // future minor-moon caller); within the regular band it never goes negative.
  const taper = clamp(1 - MOON_TAPER_STRENGTH * (hillFraction / MOON_REGULAR_HILL_FRACTION), 0, 1);
  const bias = lerp(MOON_RICHNESS_BIAS_MIN, MOON_RICHNESS_BIAS_MAX, richness);
  return clamp(base * taper * bias, 0, 1);
}

/**
 * Generate a planet's major (regular) moons as an emergent physical process:
 * walk outward through the planet's moon zone — from just outside the Roche limit
 * to a fraction of its Hill radius — in geometric steps, and at each slot roll
 * whether a moon has formed there (see `moonOccupancy`). The moon count is simply
 * how many slots fill, so it scales with the planet's mass and gravity zone with
 * no target and no cap. Draws from an independent moon rng (see `hashMoon`), so it
 * never perturbs the star/planet stream.
 */
export function generateMoons(
  rng: RandomFn,
  planetName: string,
  planetRadiusAu: number,
  planetSemiMajorAu: number,
  planetMassEarth: number,
  starMassSolar: number,
  moonRichness: number,
): MoonData[] {
  const moons: MoonData[] = [];
  const planetMassSolar = planetMassEarth * EARTH_MASS_SOLAR;
  const hillRadius = planetSemiMajorAu * Math.cbrt(planetMassSolar / (3 * starMassSolar));
  const outerEdge = hillRadius * MOON_REGULAR_HILL_FRACTION;
  let a = planetRadiusAu * MOON_INNER_RADII;
  for (let slot = 0; slot < MOON_SLOT_LIMIT; slot++) {
    a *= lerp(MOON_ORBIT_RATIO_MIN, MOON_ORBIT_RATIO_MAX, rng());
    if (a > outerEdge)
      break;
    // Roll this slot's occupancy; an empty slot is simply a gap in the system.
    if (rng() >= moonOccupancy(planetMassEarth, a / hillRadius, moonRichness))
      continue;
    const color = MOON_COLORS[randomInt(MOON_COLORS.length, rng)];
    const e = rng() ** 2 * MOON_ECC_MAX;
    const argPeriapsis = rng() * TAU;
    const meanAnomaly0 = rng() * TAU;
    const physical = sampleMoon(rng);
    moons.push({ name: nameMoon(planetName, moons.length), a, argPeriapsis, color, e, meanAnomaly0, physical, radius: planetVisualRadius(physical.radius) });
  }
  return moons;
}
