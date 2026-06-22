import type { PlanetPhysical } from './planets';
import type { StarPhysical } from './stars';

import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  ECC_MAX,
  ORBIT_INNER_AU,
  ORBIT_RATIO_MAX,
  ORBIT_RATIO_MIN,
  PLANET_MAX,
  PLANET_MIN,
  STAR_DENSITY_PEAK,
} from '../config';
import { blackHoleVisualRadius, planetVisualRadius, SECTOR_SIZE, starVisualRadius } from '../scale';
import { galaxyActivityAt, galaxyCenteredIn, galaxyDensityAt } from './galaxies';
import { hashSector, hashSystem } from './hash';
import { namePlanet, nameStar } from './naming';
import { samplePlanet } from './planets';
import { sampleStar } from './stars';

const TAU = Math.PI * 2;

const PLANET_COLORS = [
  '#8a6f52',
  '#b5764a',
  '#4a7fb5',
  '#3f9e6b',
  '#c9b88f',
  '#dad4c6',
  '#9c6b9e',
  '#6f93b0',
];

export interface PlanetData {
  name: string;
  a: number;
  argPeriapsis: number;
  color: string;
  e: number;
  meanAnomaly0: number;
  physical: PlanetPhysical;
  radius: number;
}

export interface SystemData {
  name: string;
  planets: PlanetData[];
  radius: number;
  star: StarPhysical;
  x: number;
  y: number;
}

export interface BlackHoleData {
  name: string;
  mass: number;
  radius: number;
  schwarzschildRadius: number;
  x: number;
  y: number;
}

export interface SectorData {
  blackHoles: BlackHoleData[];
  sx: number;
  sy: number;
  systems: SystemData[];
}

function choose(colors: readonly string[], rng: () => number): string {
  return colors[randomInt(colors.length, rng)];
}

/**
 * Generate the systems of one sector as plain data. Pure and deterministic:
 * the same `(worldSeed, sx, sy)` always yields a structurally identical result,
 * which is the property the streaming layer relies on (and the unit test
 * asserts). Spawning entities from this data is a separate step (`spawnSector`).
 */
export function generateSectorData(worldSeed: number, sx: number, sy: number): SectorData {
  const rng = makeSeededRng(hashSector(worldSeed, sx, sy));
  const systems: SystemData[] = [];
  const originX = sx * SECTOR_SIZE;
  const originY = sy * SECTOR_SIZE;

  // Draw a fixed number of candidate positions per sector and keep each with a
  // probability equal to the galaxy density there: an inhomogeneous Poisson
  // process whose intensity traces whichever galaxy covers the point, with no
  // lattice and seamless across sector edges. An accepted system's physics is
  // sampled from its own seed (`hashSystem`), its stars biased toward hot-blue or
  // cool-red by the local star-formation activity, so it never depends on how
  // many candidates were rejected.
  for (let i = 0; i < STAR_DENSITY_PEAK; i++) {
    const x = originX + rng() * SECTOR_SIZE;
    const y = originY + rng() * SECTOR_SIZE;
    if (rng() >= galaxyDensityAt(worldSeed, x, y))
      continue;

    const systemSeed = hashSystem(worldSeed, sx, sy, i, 0);
    const srng = makeSeededRng(systemSeed);
    const star = sampleStar(srng, galaxyActivityAt(worldSeed, x, y));
    const radius = starVisualRadius(star.radius);
    const name = nameStar(star.spectralClass, systemSeed);
    const planetCount = PLANET_MIN + randomInt(PLANET_MAX - PLANET_MIN + 1, srng);

    const planets: PlanetData[] = [];
    let a = ORBIT_INNER_AU;
    for (let j = 0; j < planetCount; j++) {
      a *= lerp(ORBIT_RATIO_MIN, ORBIT_RATIO_MAX, srng());
      // Draw into locals so eslint's object-key sorting cannot reorder the
      // rng() side effects and shift the deterministic stream.
      const color = choose(PLANET_COLORS, srng);
      const e = srng() ** 2 * ECC_MAX;
      const argPeriapsis = srng() * TAU;
      const meanAnomaly0 = srng() * TAU;
      const physical = samplePlanet(srng, star.luminosity, a);
      planets.push({ name: namePlanet(name, j), a, argPeriapsis, color, e, meanAnomaly0, physical, radius: planetVisualRadius(physical.radius) });
    }

    systems.push({ name, planets, radius, star, x, y });
  }

  // A galaxy's central black hole lives in the one sector that holds its centre.
  const blackHoles: BlackHoleData[] = [];
  const galaxy = galaxyCenteredIn(worldSeed, originX, originY, originX + SECTOR_SIZE, originY + SECTOR_SIZE);
  if (galaxy) {
    blackHoles.push({
      name: `${galaxy.name} SMBH`,
      mass: galaxy.blackHoleMass,
      radius: blackHoleVisualRadius(galaxy.blackHoleMass),
      schwarzschildRadius: galaxy.schwarzschildRadius,
      x: galaxy.centerX,
      y: galaxy.centerY,
    });
  }

  return { blackHoles, sx, sy, systems };
}
