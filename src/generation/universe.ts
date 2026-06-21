import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import { hashSector } from './hash';

const TAU = Math.PI * 2;

/** World-space side length of one sector. */
export const SECTOR_SIZE = 5000;

const SUBGRID = 4;
const CELL = SECTOR_SIZE / SUBGRID;
const EMPTY_CHANCE = 0.3;
const JITTER = 130;

const STAR_MIN_R = 28;
const STAR_MAX_R = 50;
const PLANET_MIN = 1;
const PLANET_MAX = 5;
const FIRST_GAP = 30;
const GAP_MIN = 35;
const GAP_MAX = 62;
const PLANET_MIN_R = 5;
const PLANET_MAX_R = 13;

// Keplerian angular speed: omega = ORBIT_K / a^1.5. Inner planets sweep faster.
const ORBIT_K = 600;

// Real stellar colours, blue (hot) through white and yellow to red (cool).
const STAR_COLORS = [
  '#9bb0ff',
  '#bcd0ff',
  '#e6ecff',
  '#fff6f0',
  '#fff2d6',
  '#ffe0a8',
  '#ffcaa1',
  '#ff9f80',
  '#ff7a66',
];

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
  a: number;
  color: string;
  omega: number;
  phase: number;
  radius: number;
}

export interface SystemData {
  color: string;
  planets: PlanetData[];
  radius: number;
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
      const radius = lerp(STAR_MIN_R, STAR_MAX_R, rng());
      const color = choose(STAR_COLORS, rng);
      const planetCount = PLANET_MIN + randomInt(PLANET_MAX - PLANET_MIN + 1, rng);

      const planets: PlanetData[] = [];
      let a = radius + FIRST_GAP;
      for (let i = 0; i < planetCount; i++) {
        a += lerp(GAP_MIN, GAP_MAX, rng());
        planets.push({
          a,
          color: choose(PLANET_COLORS, rng),
          omega: ORBIT_K / (a ** 1.5),
          phase: rng() * TAU,
          radius: lerp(PLANET_MIN_R, PLANET_MAX_R, rng()),
        });
      }

      if (occupied)
        systems.push({ color, planets, radius, x, y });
    }
  }

  return { sx, sy, systems };
}
