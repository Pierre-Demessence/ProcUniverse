import type { ComponentDef } from '@pierre/ecs/component-store';

import { simpleComponent } from '@pierre/ecs/component-store';
import { clamp, lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  BLACK_HOLE_MASS_MAX,
  BLACK_HOLE_MASS_MIN,
  GALAXY_ARM_PITCH_DEG,
  GALAXY_ARM_STRENGTH,
  GALAXY_ARMS_MAX,
  GALAXY_ARMS_MIN,
  GALAXY_CELL_LY,
  GALAXY_DWARF_CHANCE,
  GALAXY_OCCUPANCY,
  GALAXY_RADIUS_LY,
  GALAXY_SCALE_LENGTH_LY,
  STAR_DENSITY_PEAK,
} from '../config';
import { SECTOR_SIZE } from '../scale';
import { hashGalaxy } from './hash';
import { nameGalaxy } from './naming';
import { AU_PER_LY, SCHWARZSCHILD_AU_PER_SOLAR_MASS } from './units';

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
// Exponent that sharpens the spiral arms (higher = thinner, brighter arms).
const ARM_SHARPNESS = 2;
// Central bulge e-folding length as a fraction of the disc scale length: a tight
// bright core that fills the centre where the logarithmic arms would otherwise
// oscillate, so a galaxy's heart is always dense.
const BULGE_SCALE = 0.15;
// Central bar (barred spirals): an elongated density bridge through the core,
// as fractions of the scale length (length along the bar, width across) plus its
// strength.
const BAR_LENGTH_FRAC = 0.6;
const BAR_WIDTH_FRAC = 0.14;
const BAR_STRENGTH = 0.9;
// Baseline star-formation activity of old populations (cores, ellipticals,
// lenticulars): low, so they read red; spiral arms push toward 1 (blue).
const POP_ACTIVITY_OLD = 0.08;
// Dwarf vs normal galaxy size multipliers on the radius / scale length.
const DWARF_SIZE = [0.25, 0.5] as const;
const NORMAL_SIZE = [0.8, 1.3] as const;

/** Broad galaxy morphology (Hubble sequence, minus the deferred irregulars). */
export type GalaxyType = 'barred-spiral' | 'elliptical' | 'lenticular' | 'spiral';

/** A galaxy's central supermassive black hole, attached to its marker entity. */
export interface BlackHolePhysical {
  mass: number;
  schwarzschildRadius: number;
}

export const BlackHoleDef: ComponentDef<BlackHolePhysical> = simpleComponent<BlackHolePhysical>('blackHole', {
  mass: 'number',
  schwarzschildRadius: 'number',
});

/**
 * Seeded shape of one galaxy, derived from its grid cell. Lengths are in AU.
 * `centerX/centerY` is the galaxy's centre in absolute world coordinates; the
 * density and activity functions are evaluated relative to it.
 */
export interface GalaxyParams {
  name: string;
  arms: number;
  armStrength: number;
  blackHoleMass: number;
  centerX: number;
  centerY: number;
  dwarf: boolean;
  ellipticity: number;
  orientation: number;
  phase: number;
  pitch: number;
  radius: number;
  scaleLength: number;
  schwarzschildRadius: number;
  type: GalaxyType;
}

// Approximate field fractions of bright galaxies: barred + unbarred spirals
// dominate; ellipticals / lenticulars are the minority outside clusters.
function drawType(u: number): GalaxyType {
  if (u < 0.40)
    return 'barred-spiral';
  if (u < 0.62)
    return 'spiral';
  if (u < 0.83)
    return 'lenticular';
  return 'elliptical';
}

/**
 * Black-hole mass (M☉) in the M–σ spirit: bigger and earlier-type (spheroidal)
 * galaxies host heavier holes. `sizeNorm` ∈ [0, 1] is the galaxy's size, `heavy`
 * flags ellipticals / lenticulars, `scatter01` is a seeded spread. Pure (tested).
 */
export function blackHoleMassFromSize(sizeNorm: number, heavy: boolean, scatter01: number): number {
  const frac = clamp(sizeNorm * 0.7 + (heavy ? 0.2 : 0) + (scatter01 - 0.5) * 0.25, 0, 1);
  return 10 ** lerp(Math.log10(BLACK_HOLE_MASS_MIN), Math.log10(BLACK_HOLE_MASS_MAX), frac);
}

/**
 * Generate the galaxy occupying grid cell `(gx, gy)`, or `null` if the cell is
 * empty. Pure and deterministic from `hashGalaxy(worldSeed, gx, gy)`. The home
 * cell `(0, 0)` is always present and centred on the world origin so the app
 * starts inside a populated core; every other cell rolls occupancy and jitters
 * its centre within the cell, with the morphology drawn by field fractions.
 */
export function makeGalaxy(worldSeed: number, gx: number, gy: number): GalaxyParams | null {
  const hash = hashGalaxy(worldSeed, gx, gy);
  const rng = makeSeededRng(hash);
  // Draw into locals in a fixed order so the deterministic stream never shifts.
  const home = gx === 0 && gy === 0;
  const occupied = rng() < GALAXY_OCCUPANCY;
  if (!home && !occupied)
    return null;

  const cell = GALAXY_CELL_LY * AU_PER_LY;
  const type = drawType(rng());
  const dwarfRoll = rng();
  const dwarf = !home && dwarfRoll < GALAXY_DWARF_CHANCE;
  const [sizeLo, sizeHi] = dwarf ? DWARF_SIZE : NORMAL_SIZE;
  const sizeScale = lerp(sizeLo, sizeHi, rng());
  const jitterX = rng();
  const jitterY = rng();
  const centerX = home ? 0 : (gx + jitterX) * cell;
  const centerY = home ? 0 : (gy + jitterY) * cell;
  const arms = GALAXY_ARMS_MIN + randomInt(GALAXY_ARMS_MAX - GALAXY_ARMS_MIN + 1, rng);
  const ellipticity = type === 'elliptical' ? lerp(0.5, 0.85, rng()) : 1;
  const orientation = rng() * TAU;
  const phase = rng() * TAU;
  const heavy = type === 'elliptical' || type === 'lenticular';
  const sizeNorm = (sizeScale - DWARF_SIZE[0]) / (NORMAL_SIZE[1] - DWARF_SIZE[0]);
  const blackHoleMass = blackHoleMassFromSize(sizeNorm, heavy, rng());

  return {
    name: nameGalaxy(hash),
    arms,
    armStrength: GALAXY_ARM_STRENGTH,
    blackHoleMass,
    centerX,
    centerY,
    dwarf,
    ellipticity,
    orientation,
    phase,
    pitch: GALAXY_ARM_PITCH_DEG * DEG_TO_RAD,
    radius: GALAXY_RADIUS_LY * AU_PER_LY * sizeScale,
    scaleLength: GALAXY_SCALE_LENGTH_LY * AU_PER_LY * sizeScale,
    schwarzschildRadius: blackHoleMass * SCHWARZSCHILD_AU_PER_SOLAR_MASS,
    type,
  };
}

const cellCache = new Map<string, GalaxyParams | null>();
const CELL_CACHE_CAP = 4096;

/** Memoised `makeGalaxy`, since the 3×3 scans re-read the same cells often. */
export function galaxyInCell(worldSeed: number, gx: number, gy: number): GalaxyParams | null {
  const key = `${worldSeed},${gx},${gy}`;
  const cached = cellCache.get(key);
  if (cached !== undefined)
    return cached;
  const galaxy = makeGalaxy(worldSeed, gx, gy);
  cellCache.set(key, galaxy);
  if (cellCache.size > CELL_CACHE_CAP) {
    const oldest = cellCache.keys().next().value;
    if (oldest !== undefined)
      cellCache.delete(oldest);
  }
  return galaxy;
}

// Logarithmic-spiral arm intensity in [0, 1] at polar `(r, theta)`.
function armTerm(g: GalaxyParams, r: number, theta: number): number {
  if (r === 0)
    return 1;
  const armPhase = g.arms * (theta - Math.log(r) / Math.tan(g.pitch)) - g.phase;
  return (0.5 + 0.5 * Math.cos(armPhase)) ** ARM_SHARPNESS;
}

/**
 * Normalised star density in `[0, 1]` for a single galaxy at world `(x, y)`
 * (1 at the core, 0 beyond the rim). An exponential disc plus a bright bulge;
 * spirals multiply in logarithmic arms (barred ones add a central bar),
 * lenticulars drop the arms, and ellipticals use an ellipse-squashed radius.
 */
export function galaxyDensityOf(g: GalaxyParams, x: number, y: number): number {
  const cosO = Math.cos(g.orientation);
  const sinO = Math.sin(g.orientation);
  const dx = x - g.centerX;
  const dy = y - g.centerY;
  const xr = dx * cosO + dy * sinO;
  const yr = -dx * sinO + dy * cosO;

  if (g.type === 'elliptical') {
    const rEff = Math.hypot(xr, yr / g.ellipticity);
    return rEff > g.radius ? 0 : Math.exp(-rEff / g.scaleLength);
  }

  const r = Math.hypot(xr, yr);
  if (r > g.radius)
    return 0;
  const radial = Math.exp(-r / g.scaleLength);
  const bulge = Math.exp(-r / (g.scaleLength * BULGE_SCALE));
  const theta = Math.atan2(yr, xr);
  const armFactor = g.type === 'lenticular' ? 1 : 1 - g.armStrength + g.armStrength * armTerm(g, r, theta);
  let density = bulge + radial * armFactor;
  if (g.type === 'barred-spiral') {
    const barL = g.scaleLength * BAR_LENGTH_FRAC;
    const barW = g.scaleLength * BAR_WIDTH_FRAC;
    density += BAR_STRENGTH * Math.exp(-((xr / barL) ** 2) - ((yr / barW) ** 2));
  }
  return Math.min(1, density);
}

/**
 * Star-formation activity in `[0, 1]` for a single galaxy at `(x, y)`: high on
 * spiral arms (young, hot, blue stars), low in old cores and across elliptical /
 * lenticular galaxies (cool, red stars). Drives the population colour bias.
 */
export function galaxyActivityOf(g: GalaxyParams, x: number, y: number): number {
  if (g.type === 'elliptical' || g.type === 'lenticular')
    return POP_ACTIVITY_OLD;
  const cosO = Math.cos(g.orientation);
  const sinO = Math.sin(g.orientation);
  const dx = x - g.centerX;
  const dy = y - g.centerY;
  const xr = dx * cosO + dy * sinO;
  const yr = -dx * sinO + dy * cosO;
  const r = Math.hypot(xr, yr);
  if (r === 0 || r > g.radius)
    return POP_ACTIVITY_OLD;
  const radial = Math.exp(-r / g.scaleLength);
  const bulge = Math.exp(-r / (g.scaleLength * BULGE_SCALE));
  const diskFraction = radial / (radial + bulge);
  return clamp(armTerm(g, r, Math.atan2(yr, xr)) * diskFraction, POP_ACTIVITY_OLD, 1);
}

// The galaxy (if any) whose density dominates at `(x, y)`, scanning the 3×3
// neighbouring cells — sufficient because a galaxy radius is far smaller than a
// cell, so only an immediate neighbour's disc can reach in.
function dominantGalaxy(worldSeed: number, x: number, y: number): { density: number; galaxy: GalaxyParams } | null {
  const cell = GALAXY_CELL_LY * AU_PER_LY;
  const baseX = Math.floor(x / cell);
  const baseY = Math.floor(y / cell);
  let best: GalaxyParams | null = null;
  let bestDensity = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const g = galaxyInCell(worldSeed, baseX + dx, baseY + dy);
      if (!g)
        continue;
      const d = galaxyDensityOf(g, x, y);
      if (d > bestDensity) {
        bestDensity = d;
        best = g;
      }
    }
  }
  return best ? { density: bestDensity, galaxy: best } : null;
}

/** The galaxy whose density dominates at world `(x, y)`, or `null` in the void. */
export function galaxyAt(worldSeed: number, x: number, y: number): GalaxyParams | null {
  return dominantGalaxy(worldSeed, x, y)?.galaxy ?? null;
}

/** Normalised star density across all galaxies at world `(x, y)`. */
export function galaxyDensityAt(worldSeed: number, x: number, y: number): number {
  return dominantGalaxy(worldSeed, x, y)?.density ?? 0;
}

/** Star-formation activity at world `(x, y)` from the dominant galaxy. */
export function galaxyActivityAt(worldSeed: number, x: number, y: number): number {
  const dom = dominantGalaxy(worldSeed, x, y);
  return dom ? galaxyActivityOf(dom.galaxy, x, y) : POP_ACTIVITY_OLD;
}

/**
 * The galaxy whose centre lies within the box `[minX, maxX) × [minY, maxY)`, or
 * `null`. Used to place a galaxy's central black hole in the one sector that
 * contains its centre. A sector is far smaller than a galaxy cell, so only that
 * sector's own cell can hold a centre inside it.
 */
export function galaxyCenteredIn(worldSeed: number, minX: number, minY: number, maxX: number, maxY: number): GalaxyParams | null {
  const cell = GALAXY_CELL_LY * AU_PER_LY;
  const g = galaxyInCell(worldSeed, Math.floor(minX / cell), Math.floor(minY / cell));
  if (g && g.centerX >= minX && g.centerX < maxX && g.centerY >= minY && g.centerY < maxY)
    return g;
  return null;
}

/** Rough visible diameter of a galaxy in light-years (≈ 2× the disc radius). */
export function galaxyDiameterLy(g: GalaxyParams): number {
  return (2 * g.radius) / AU_PER_LY;
}

/** A galaxy's representative population activity for colouring (0 old … 1 young). */
export function galaxyRepresentativeActivity(g: GalaxyParams): number {
  return g.type === 'spiral' || g.type === 'barred-spiral' ? 0.7 : 0.12;
}

/**
 * A rough display estimate of a galaxy's star count. The generator keeps
 * `STAR_DENSITY_PEAK` candidates per sector weighted by density, so the total is
 * the density integral over the disc (≈ 2π·scaleLength² for an exponential disc)
 * divided by the sector area.
 */
export function estimatedStarCount(g: GalaxyParams): number {
  const sectorArea = SECTOR_SIZE * SECTOR_SIZE;
  return Math.round((STAR_DENSITY_PEAK * 2 * Math.PI * g.scaleLength * g.scaleLength) / sectorArea);
}

/** Yield every galaxy whose cell overlaps the world rectangle `[minX,maxX]×[minY,maxY]`. */
export function* galaxiesInRect(worldSeed: number, minX: number, minY: number, maxX: number, maxY: number): Generator<GalaxyParams> {
  const cell = GALAXY_CELL_LY * AU_PER_LY;
  const gx0 = Math.floor(minX / cell);
  const gx1 = Math.floor(maxX / cell);
  const gy0 = Math.floor(minY / cell);
  const gy1 = Math.floor(maxY / cell);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const g = galaxyInCell(worldSeed, gx, gy);
      if (g)
        yield g;
    }
  }
}
