import type { MoonData } from './moons';
import type { PlanetPhysical } from './planets';
import type { StarPhysical } from './stars';

import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  DISK_OUTER_AU,
  DISK_OUTER_MAX_AU,
  ECC_MAX,
  ORBIT_INNER_AU,
  ORBIT_INNER_MIN_AU,
  ORBIT_RATIO_MAX,
  ORBIT_RATIO_MIN,
  ORBIT_RATIO_OUTER_MAX,
  ORBIT_RATIO_OUTER_MIN,
  PLANET_MAX,
  PLANET_MIN,
  STAR_DENSITY_PEAK,
} from '../config/data';
import { blackHoleVisualRadius, planetVisualRadius, SECTOR_SIZE, starVisualRadius } from '../scale';
import { galaxyActivityAt, galaxyCenteredIn, galaxyDensityAt, universeAge } from './galaxies';
import { hashMoon, hashSector, hashSystem } from './hash';
import { generateMoons } from './moons';
import { namePlanet, nameStar } from './naming';
import { frostLine, samplePlanet } from './planets';
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
  moons: MoonData[];
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
  eddingtonRatio: number;
  mass: number;
  radius: number;
  schwarzschildRadius: number;
  spin: number;
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
  const cosmicAge = universeAge(worldSeed);

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
    const star = sampleStar(srng, galaxyActivityAt(worldSeed, x, y), cosmicAge);
    const radius = starVisualRadius(star.radius);
    const name = nameStar(star.spectralClass, systemSeed);
    const planetCount = PLANET_MIN + randomInt(PLANET_MAX - PLANET_MIN + 1, srng);

    const planets: PlanetData[] = [];
    const frost = frostLine(star.luminosity);
    // The planet-forming disk scales with the star: its inner edge tracks the
    // dust-sublimation radius (∝ √L, floored so a faint star never places a
    // planet inside itself) and its outer edge the disk's reach (capped at a
    // realistic extent). A luminous star's planets thus start farther out and
    // reach its distant habitable zone / frost line; a dim star's hug it.
    const rootLuminosity = Math.sqrt(star.luminosity);
    const innerEdge = Math.max(ORBIT_INNER_AU * rootLuminosity, ORBIT_INNER_MIN_AU);
    const diskOuter = Math.min(DISK_OUTER_AU * rootLuminosity, DISK_OUTER_MAX_AU);
    let a = innerEdge;
    for (let j = 0; j < planetCount; j++) {
      // Beyond the frost line, orbits are spaced more widely — that is where
      // giants form and real systems separate (the asteroid-belt gap, then the
      // outer giants). Always one draw, so the deterministic stream is unchanged;
      // only the multiplier's range shifts with the orbit's position.
      const spacing = srng();
      a *= a >= frost
        ? lerp(ORBIT_RATIO_OUTER_MIN, ORBIT_RATIO_OUTER_MAX, spacing)
        : lerp(ORBIT_RATIO_MIN, ORBIT_RATIO_MAX, spacing);
      // Stop at the disk's outer edge — a smaller disk simply holds fewer planets.
      if (a > diskOuter)
        break;
      // Draw into locals so eslint's object-key sorting cannot reorder the
      // rng() side effects and shift the deterministic stream.
      const color = choose(PLANET_COLORS, srng);
      const e = srng() ** 2 * ECC_MAX;
      const argPeriapsis = srng() * TAU;
      const meanAnomaly0 = srng() * TAU;
      const physical = samplePlanet(srng, star.luminosity, a, star.mass, star.age, star.metallicity);
      const planetName = namePlanet(name, j);
      const radius = planetVisualRadius(physical.radius);
      // Moons come from an independent per-planet stream, so they never perturb
      // the star/planet draws; their count emerges from the planet's mass and
      // Hill sphere (see generateMoons), scaled by its moon-richness trait.
      const moonRng = makeSeededRng(hashMoon(systemSeed, j));
      const moons = generateMoons(moonRng, planetName, radius, a, physical.mass, star.mass, physical.moonRichness);
      planets.push({ name: planetName, a, argPeriapsis, color, e, meanAnomaly0, moons, physical, radius });
    }

    systems.push({ name, planets, radius, star, x, y });
  }

  // A galaxy's central black hole lives in the one sector that holds its centre.
  const blackHoles: BlackHoleData[] = [];
  const galaxy = galaxyCenteredIn(worldSeed, originX, originY, originX + SECTOR_SIZE, originY + SECTOR_SIZE);
  if (galaxy) {
    blackHoles.push({
      name: `${galaxy.name} SMBH`,
      eddingtonRatio: galaxy.blackHoleEddingtonRatio,
      mass: galaxy.blackHoleMass,
      radius: blackHoleVisualRadius(galaxy.blackHoleMass),
      schwarzschildRadius: galaxy.schwarzschildRadius,
      spin: galaxy.blackHoleSpin,
      x: galaxy.centerX,
      y: galaxy.centerY,
    });
  }

  return { blackHoles, sx, sy, systems };
}
