import type { MoonData } from './moons';
import type { GeneratedName } from './naming';
import type { PlanetPhysical } from './planets';
import type { StarPhysical } from './stars';

import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  DISK_OUTER_AU,
  DISK_OUTER_MAX_AU,
  ECC_MAX,
  INCLINATION_ECC_RATIO,
  INCLINATION_MULT_COLD,
  INCLINATION_MULT_HOT,
  ORBIT_INNER_AU,
  ORBIT_INNER_MIN_AU,
  ORBIT_RATIO_MAX,
  ORBIT_RATIO_MIN,
  ORBIT_RATIO_OUTER_MAX,
  ORBIT_RATIO_OUTER_MIN,
  PLANET_MAX,
  PLANET_MIN,
} from '../config/data';
import { blackHoleVisualRadius, planetVisualRadius, SECTOR_SIZE, starVisualRadius } from '../scale';
import { planeToElements, tiltNormal } from '../sim/orbits';
import { galaxyCenteredIn, galaxyDensityBoundAt, galaxySampleAt, STAR_PEAK_PER_AU3, universeAge } from './galaxies';
import { hashMoon, hashSector, hashSystem } from './hash';
import { generateMoons } from './moons';
import { namePlanet, nameStar } from './naming';
import { earthSimilarityIndex, escapeVelocity, frostLine, samplePlanet } from './planets';
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
  name: GeneratedName;
  a: number;
  argPeriapsis: number;
  color: string;
  e: number;
  inclination: number;
  longitudeAscendingNode: number;
  meanAnomaly0: number;
  moons: MoonData[];
  physical: PlanetPhysical;
  radius: number;
}

/**
 * The star-only record of a system, what a sector holds: position, name and star
 * physics. Planets and moons come from `generateSystem`, when the system is
 * streamed or inspected.
 */
export interface StarData {
  name: GeneratedName;
  /** Star-formation activity at the star's position, which biases its sampled type. */
  activity: number;
  radius: number;
  /** The system's own seed (`hashSystem`), the start of every draw after its position. */
  seed: number;
  star: StarPhysical;
  x: number;
  y: number;
  z: number;
}

export interface SystemData extends StarData {
  /** Unit normal of the system's mean orbital (disk) plane, in world space. */
  diskNormal: [number, number, number];
  planets: PlanetData[];
}

export interface BlackHoleData {
  name: GeneratedName;
  eddingtonRatio: number;
  mass: number;
  radius: number;
  schwarzschildRadius: number;
  spin: number;
  x: number;
  y: number;
  z: number;
}

export interface SectorData {
  blackHoles: BlackHoleData[];
  stars: StarData[];
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Whether `a` and `b` are the same system: same catalogue name and position.
 * The 5-digit catalogue name alone can repeat between systems in view; the
 * position is exact, since a regenerated sector reproduces it bit for bit.
 */
export function isSameSystem(a: Pick<StarData, 'name' | 'x' | 'y' | 'z'>, b: Pick<StarData, 'name' | 'x' | 'y' | 'z'>): boolean {
  return a.name.scientific === b.name.scientific && a.x === b.x && a.y === b.y && a.z === b.z;
}

function choose(colors: readonly string[], rng: () => number): string {
  return colors[randomInt(colors.length, rng)];
}

// Above this mean, a Poisson count is drawn from its normal approximation
// (Knuth's product method costs one draw per unit of mean).
const POISSON_NORMAL_MEAN = 30;

/**
 * A Poisson-distributed count with the given mean, drawn from `rng`: Knuth's
 * product method for small means, a rounded normal approximation for large ones.
 */
export function samplePoisson(mean: number, rng: () => number): number {
  if (mean <= 0)
    return 0;
  if (mean > POISSON_NORMAL_MEAN) {
    const u1 = rng();
    const u2 = rng();
    const gaussian = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian));
  }
  const limit = Math.exp(-mean);
  let count = 0;
  let product = rng();
  while (product > limit) {
    count++;
    product *= rng();
  }
  return count;
}

const SECTOR_VOLUME = SECTOR_SIZE ** 3;
const SECTOR_HALF_DIAGONAL = (SECTOR_SIZE * Math.sqrt(3)) / 2;

/**
 * Generate the stars of one cubic sector as plain data: star-only records, the
 * cheap part of a system, so a star-tier view can hold thousands of them. Pure
 * and deterministic: the same `(worldSeed, sx, sy, sz)` always yields a
 * structurally identical result, which is the property the streaming layer
 * relies on (and the unit test asserts). A system's planets and moons come from
 * `generateSystem`; spawning entities is a separate step (`spawnSector`).
 */
export function generateSectorData(worldSeed: number, sx: number, sy: number, sz: number): SectorData {
  const rng = makeSeededRng(hashSector(worldSeed, sx, sy, sz));
  const stars: StarData[] = [];
  const originX = sx * SECTOR_SIZE;
  const originY = sy * SECTOR_SIZE;
  const originZ = sz * SECTOR_SIZE;
  const cosmicAge = universeAge(worldSeed);

  // Stars form an inhomogeneous Poisson process whose intensity traces the
  // galaxy density, with no lattice and seamless across sector faces. It is
  // sampled by thinning: draw a Poisson number of uniform candidates at the
  // density's upper bound over the cube, then keep each with probability
  // density / bound. Empty space (bound 0) costs one bound and no candidates.
  // An accepted star is sampled from its own seed (`hashSystem`), biased toward
  // hot-blue or cool-red by the local star-formation activity, so it never
  // depends on how many candidates were rejected.
  const bound = galaxyDensityBoundAt(worldSeed, originX + SECTOR_SIZE / 2, originY + SECTOR_SIZE / 2, originZ + SECTOR_SIZE / 2, SECTOR_HALF_DIAGONAL);
  const candidates = samplePoisson(STAR_PEAK_PER_AU3 * SECTOR_VOLUME * bound, rng);
  for (let i = 0; i < candidates; i++) {
    const x = originX + rng() * SECTOR_SIZE;
    const y = originY + rng() * SECTOR_SIZE;
    const z = originZ + rng() * SECTOR_SIZE;
    const sample = galaxySampleAt(worldSeed, x, y, z);
    if (rng() * bound >= sample.density)
      continue;

    const seed = hashSystem(worldSeed, sx, sy, sz, i);
    const star = sampleStar(makeSeededRng(seed), sample.activity, cosmicAge);
    stars.push({ name: nameStar(star.spectralClass, seed), activity: sample.activity, radius: starVisualRadius(star.radius), seed, star, x, y, z });
  }

  // A galaxy's central black hole lives in the one sector that holds its centre.
  const blackHoles: BlackHoleData[] = [];
  const galaxy = galaxyCenteredIn(worldSeed, originX, originY, originZ, originX + SECTOR_SIZE, originY + SECTOR_SIZE, originZ + SECTOR_SIZE);
  if (galaxy) {
    blackHoles.push({
      name: { human: `${galaxy.humanName} SMBH`, scientific: `${galaxy.name} SMBH` },
      eddingtonRatio: galaxy.blackHoleEddingtonRatio,
      mass: galaxy.blackHoleMass,
      radius: blackHoleVisualRadius(galaxy.blackHoleMass),
      schwarzschildRadius: galaxy.schwarzschildRadius,
      spin: galaxy.blackHoleSpin,
      x: galaxy.centerX,
      y: galaxy.centerY,
      z: galaxy.centerZ,
    });
  }

  return { blackHoles, stars, sx, sy, sz };
}

/**
 * Generate a star's planets and moons: the full system around a sector's
 * star-only record. Pure and deterministic like the sector, and it continues the
 * star's own stream where the record left off (re-drawing the star advances it),
 * so the bodies never depend on when or how often the system is generated.
 */
export function generateSystem(worldSeed: number, record: StarData): SystemData {
  const srng = makeSeededRng(record.seed);
  sampleStar(srng, record.activity, universeAge(worldSeed));
  const { name: systemName, seed: systemSeed, star } = record;
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
    const planetHash = hashMoon(systemSeed, j);
    const esi = earthSimilarityIndex(
      physical.radius,
      physical.density,
      escapeVelocity(physical.mass, physical.radius),
      physical.equilibriumTemp,
    );
    const planetName = namePlanet(systemName, j, planetHash, esi);
    const radius = planetVisualRadius(physical.radius);
    // Moons come from an independent per-planet stream, so they never perturb
    // the star/planet draws; their count emerges from the planet's mass and
    // Hill sphere (see generateMoons), scaled by its moon-richness trait.
    const moonRng = makeSeededRng(planetHash);
    const moons = generateMoons(moonRng, planetName, radius, a, physical.mass, star.mass, physical.moonRichness);
    planets.push({ name: planetName, a, argPeriapsis, color, e, inclination: 0, longitudeAscendingNode: 0, meanAnomaly0, moons, physical, radius });
  }

  // Second pass — 3D orbital orientation. Drawn here, after every planet's own
  // sampling, so these appended draws never perturb the star / planet / moon
  // streams: the flat universe is unchanged, it only gains tilt. The disk gets a
  // uniformly random 3D orientation; each planet tilts from it by a mutual
  // inclination whose spread scales with its eccentricity (equipartition) and
  // shrinks as the planet count grows (the Kepler dichotomy); its moons ride the
  // planet's equatorial plane — the orbit tilted by the axial obliquity.
  const diskZ = 1 - 2 * srng();
  const diskAzimuth = srng() * TAU;
  const diskR = Math.sqrt(Math.max(0, 1 - diskZ * diskZ));
  const diskNx = diskR * Math.cos(diskAzimuth);
  const diskNy = diskR * Math.sin(diskAzimuth);
  const multiplicity = lerp(
    INCLINATION_MULT_HOT,
    INCLINATION_MULT_COLD,
    planetCount > PLANET_MIN ? (planetCount - PLANET_MIN) / (PLANET_MAX - PLANET_MIN) : 0,
  );
  for (const planet of planets) {
    const sigma = INCLINATION_ECC_RATIO * planet.e * multiplicity;
    const mutualInc = Math.min(Math.PI / 2, sigma * Math.sqrt(-2 * Math.log(1 - srng())));
    const [onx, ony, onz] = tiltNormal(diskNx, diskNy, diskZ, mutualInc, srng() * TAU);
    const orbitPlane = planeToElements(onx, ony, onz);
    planet.inclination = orbitPlane.inclination;
    planet.longitudeAscendingNode = orbitPlane.longitudeAscendingNode;
    // Equatorial (moon) plane: the orbit normal tilted by the axial obliquity
    // around a random azimuth, which is also stored so the sphere can spin on it.
    const spinAzimuth = srng() * TAU;
    planet.physical.obliquityAzimuth = spinAzimuth;
    const [snx, sny, snz] = tiltNormal(onx, ony, onz, planet.physical.obliquity * (Math.PI / 180), spinAzimuth);
    const equator = planeToElements(snx, sny, snz);
    for (const moon of planet.moons) {
      moon.inclination = equator.inclination;
      moon.longitudeAscendingNode = equator.longitudeAscendingNode;
    }
  }

  return { ...record, diskNormal: [diskNx, diskNy, diskZ], planets };
}
