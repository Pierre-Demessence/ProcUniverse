import type { ComponentDef } from '@pierre/ecs/component-store';
import type { RandomFn } from '@pierre/ecs/modules/rng';

import { simpleComponent } from '@pierre/ecs/component-store';
import { lerp } from '@pierre/ecs/modules/math';
import { randomInt } from '@pierre/ecs/modules/rng';

import { planetVisualRadius } from '../scale';
import { nameMoon } from './naming';
import { massToRadius } from './planets';

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
// Moons orbit from just outside the Roche limit (~a few planet radii) outward,
// geometric-spaced, and only as far as a fraction of the planet's Hill radius so
// they stay gravitationally bound (beyond it the star would strip them away).
const MOON_INNER_RADII = 2.5;
const MOON_ORBIT_RATIO_MIN = 1.5;
const MOON_ORBIT_RATIO_MAX = 2.2;
const MOON_HILL_FRACTION = 0.4;
const MOON_ECC_MAX = 0.05;
const MOON_COLORS = ['#b8b0a4', '#9aa7b3', '#c8bfa8', '#8f8f8f', '#a89684'] as const;

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
 * Generate a planet's major moons: geometric orbits from just outside the Roche
 * limit out to a fraction of the planet's Hill radius (a moon past it is not
 * bound), each with a sampled physical state and a Roman-numeral name. Draws from
 * an independent moon rng (see `hashMoon`), so it never perturbs the star/planet
 * stream. A tight Hill sphere simply holds fewer moons than the drawn count.
 */
export function generateMoons(
  rng: RandomFn,
  planetName: string,
  planetRadiusAu: number,
  planetSemiMajorAu: number,
  planetMassSolar: number,
  starMassSolar: number,
  moonCount: number,
): MoonData[] {
  const moons: MoonData[] = [];
  const hillRadius = planetSemiMajorAu * Math.cbrt(planetMassSolar / (3 * starMassSolar));
  let a = planetRadiusAu * MOON_INNER_RADII;
  for (let k = 0; k < moonCount; k++) {
    a *= lerp(MOON_ORBIT_RATIO_MIN, MOON_ORBIT_RATIO_MAX, rng());
    if (a > hillRadius * MOON_HILL_FRACTION)
      break;
    const color = MOON_COLORS[randomInt(MOON_COLORS.length, rng)];
    const e = rng() ** 2 * MOON_ECC_MAX;
    const argPeriapsis = rng() * TAU;
    const meanAnomaly0 = rng() * TAU;
    const physical = sampleMoon(rng);
    moons.push({ name: nameMoon(planetName, k), a, argPeriapsis, color, e, meanAnomaly0, physical, radius: planetVisualRadius(physical.radius) });
  }
  return moons;
}
