import type { PlanetPhysical } from './planets';
import type { StarPhysical } from './stars';

import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  ECC_MAX,
  EMPTY_CHANCE,
  JITTER_FRACTION,
  ORBIT_INNER_AU,
  ORBIT_RATIO_MAX,
  ORBIT_RATIO_MIN,
  PLANET_MAX,
  PLANET_MIN,
  SUBGRID,
} from '../config';
import { planetVisualRadius, SECTOR_SIZE, starVisualRadius } from '../scale';
import { hashSector, hashSystem } from './hash';
import { namePlanet, nameStar } from './naming';
import { samplePlanet } from './planets';
import { sampleStar } from './stars';

const TAU = Math.PI * 2;

// Per-cell size and the absolute jitter, derived from the configured density.
const CELL = SECTOR_SIZE / SUBGRID;
const JITTER = CELL * JITTER_FRACTION;

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

export interface SectorData {
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

  for (let gy = 0; gy < SUBGRID; gy++) {
    for (let gx = 0; gx < SUBGRID; gx++) {
      // Draw the same rolls per cell regardless of outcome to keep a stable
      // sequence; only commit a system when the cell is non-empty.
      const occupied = rng() >= EMPTY_CHANCE;
      const x = originX + (gx + 0.5) * CELL + (rng() * 2 - 1) * JITTER;
      const y = originY + (gy + 0.5) * CELL + (rng() * 2 - 1) * JITTER;
      const star = sampleStar(rng);
      const radius = starVisualRadius(star.radius);
      // Names fold only seed + coordinates + class (no rng()), so deriving them
      // here never shifts the deterministic physics draws below.
      const name = nameStar(star.spectralClass, hashSystem(worldSeed, sx, sy, gx, gy));
      const planetCount = PLANET_MIN + randomInt(PLANET_MAX - PLANET_MIN + 1, rng);

      const planets: PlanetData[] = [];
      let a = ORBIT_INNER_AU;
      for (let i = 0; i < planetCount; i++) {
        a *= lerp(ORBIT_RATIO_MIN, ORBIT_RATIO_MAX, rng());
        // Draw into locals so eslint's object-key sorting cannot reorder the
        // rng() side effects and shift the deterministic stream.
        const color = choose(PLANET_COLORS, rng);
        const e = rng() ** 2 * ECC_MAX;
        const argPeriapsis = rng() * TAU;
        const meanAnomaly0 = rng() * TAU;
        const physical = samplePlanet(rng, star.luminosity, a);
        planets.push({ name: namePlanet(name, i), a, argPeriapsis, color, e, meanAnomaly0, physical, radius: planetVisualRadius(physical.radius) });
      }

      if (occupied)
        systems.push({ name, planets, radius, star, x, y });
    }
  }

  return { sx, sy, systems };
}
