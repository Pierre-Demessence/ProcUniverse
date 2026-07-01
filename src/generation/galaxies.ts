import type { ComponentDef } from '@pierre/ecs/component-store';

import { simpleComponent } from '@pierre/ecs/component-store';
import { clamp, lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  BLACK_HOLE_MASS_MAX,
  BLACK_HOLE_MASS_MIN,
  COSMIC_WEB_CELLS,
  COSMIC_WEB_STRENGTH,
  GALAXY_ARM_PITCH_DEG,
  GALAXY_ARM_STRENGTH,
  GALAXY_ARMS_MAX,
  GALAXY_ARMS_MIN,
  GALAXY_CELL_LY,
  GALAXY_DWARF_CHANCE,
  GALAXY_OCCUPANCY,
  GALAXY_RADIUS_LY,
  GALAXY_SCALE_LENGTH_LY,
  MORPH_DENSITY_BIAS,
  STAR_DENSITY_PEAK,
} from '../config/data';
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
  eddingtonRatio: number;
  mass: number;
  schwarzschildRadius: number;
  spin: number;
}

export const BlackHoleDef: ComponentDef<BlackHolePhysical> = simpleComponent<BlackHolePhysical>('blackHole', {
  eddingtonRatio: 'number',
  mass: 'number',
  schwarzschildRadius: 'number',
  spin: 'number',
});

/**
 * Seeded shape of one galaxy, derived from its grid cell. Lengths are in AU.
 * `centerX/centerY` is the galaxy's centre in absolute world coordinates; the
 * density and activity functions are evaluated relative to it.
 */
export interface GalaxyParams {
  /** Scientific catalogue designation (stable key), e.g. `NGC-4F2A9`. */
  name: string;
  arms: number;
  armStrength: number;
  blackHoleEddingtonRatio: number;
  blackHoleMass: number;
  blackHoleSpin: number;
  centerX: number;
  centerY: number;
  cosmicDensity: number;
  dwarf: boolean;
  ellipticity: number;
  /** Human-readable name for the 'human' naming style, e.g. `Korvannis`. */
  humanName: string;
  orientation: number;
  phase: number;
  pitch: number;
  radius: number;
  scaleLength: number;
  schwarzschildRadius: number;
  type: GalaxyType;
}

// Approximate field fractions of bright galaxies: barred + unbarred spirals
// dominate; ellipticals / lenticulars are the minority outside clusters. The
// `cosmic` density skews the mix spheroidal in clusters (morphology–density).
function drawType(u: number, cosmic: number): GalaxyType {
  const s = MORPH_DENSITY_BIAS * (cosmic - 0.5);
  const wBarred = clamp(0.40 - s, 0.05, 0.95);
  const wSpiral = clamp(0.22 - s, 0.05, 0.95);
  const wLenticular = clamp(0.21 + s, 0.05, 0.95);
  const wElliptical = clamp(0.17 + s, 0.05, 0.95);
  const t = u * (wBarred + wSpiral + wLenticular + wElliptical);
  if (t < wBarred)
    return 'barred-spiral';
  if (t < wBarred + wSpiral)
    return 'spiral';
  if (t < wBarred + wSpiral + wLenticular)
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

// Black-hole derived-quantity constants: the Hawking temperature and evaporation
// time per solar mass, the Eddington luminosity per solar mass (L☉), and the
// photon-sphere / ISCO / shadow radii as multiples of the Schwarzschild radius.
const HAWKING_TEMPERATURE_SOLAR_K = 6.17e-8;
const EVAPORATION_TIME_SOLAR_YEARS = 2.1e67;
const EDDINGTON_LUMINOSITY_PER_SOLAR_MASS = 3.3e4;
const PHOTON_SPHERE_FACTOR = 1.5;
const SHADOW_DIAMETER_FACTOR = 5.2;

/** Hawking temperature (K): `6.17×10⁻⁸ · (M☉/M)` — vanishingly cold for SMBHs. */
export function hawkingTemperature(massSolar: number): number {
  return HAWKING_TEMPERATURE_SOLAR_K / massSolar;
}

/** Evaporation time (years): `≈ 2.1×10⁶⁷ · (M/M☉)³` — far beyond cosmic timescales. */
export function evaporationTime(massSolar: number): number {
  return EVAPORATION_TIME_SOLAR_YEARS * massSolar ** 3;
}

/** Photon-sphere radius (AU): `1.5·r_s`, where light itself can orbit. */
export function photonSphere(schwarzschildRadius: number): number {
  return PHOTON_SPHERE_FACTOR * schwarzschildRadius;
}

/**
 * Innermost stable circular orbit (AU) — the accretion disc's inner edge. For a
 * non-spinning hole it is `3·r_s`; a prograde orbit around a maximally spinning
 * (Kerr) hole shrinks it toward `0.5·r_s` (Bardeen et al. 1972).
 */
export function innermostStableOrbit(schwarzschildRadius: number, spin = 0): number {
  const a = clamp(spin, 0, 0.9999);
  const z1 = 1 + (1 - a ** 2) ** (1 / 3) * ((1 + a) ** (1 / 3) + (1 - a) ** (1 / 3));
  const z2 = Math.sqrt(3 * a ** 2 + z1 ** 2);
  const radiusOverM = 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return (radiusOverM / 2) * schwarzschildRadius;
}

/** Apparent shadow diameter (AU): `≈ 5.2·r_s` — what the Event Horizon Telescope images. */
export function shadowDiameter(schwarzschildRadius: number): number {
  return SHADOW_DIAMETER_FACTOR * schwarzschildRadius;
}

/** Eddington luminosity (L☉): `3.3×10⁴ · (M/M☉)` — the steady accretion-power ceiling. */
export function eddingtonLuminosity(massSolar: number): number {
  return EDDINGTON_LUMINOSITY_PER_SOLAR_MASS * massSolar;
}

// Eddington-ratio threshold above which a black hole is an active galactic
// nucleus (a bright accreting quasar/AGN); most hosts sit far below it.
const AGN_THRESHOLD = 0.02;

/** Whether a black hole is an active galactic nucleus (accreting near Eddington). */
export function isActiveGalacticNucleus(eddingtonRatio: number): boolean {
  return eddingtonRatio > AGN_THRESHOLD;
}

// Cosmic-web value noise: hash a coarse grid of nodes (every COSMIC_WEB_CELLS
// galaxy cells) and bilinearly interpolate for a smooth large-scale density.
const COSMIC_SALT = 0x1B873593;

function webNode(worldSeed: number, wx: number, wy: number): number {
  return hashGalaxy((worldSeed ^ COSMIC_SALT) >>> 0, wx, wy) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Smooth large-scale "cosmic web" density in `[0, 1]` over galaxy-cell coords:
 * value noise that clusters galaxies into filaments and voids and skews their
 * morphology (dense → spheroidal). Pure and deterministic.
 */
export function cosmicDensity(worldSeed: number, gx: number, gy: number): number {
  const fx = gx / COSMIC_WEB_CELLS;
  const fy = gy / COSMIC_WEB_CELLS;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);
  const v00 = webNode(worldSeed, x0, y0);
  const v10 = webNode(worldSeed, x0 + 1, y0);
  const v01 = webNode(worldSeed, x0, y0 + 1);
  const v11 = webNode(worldSeed, x0 + 1, y0 + 1);
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
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
  const cosmic = cosmicDensity(worldSeed, gx, gy);
  const occupancy = clamp(GALAXY_OCCUPANCY * (1 - COSMIC_WEB_STRENGTH + 2 * COSMIC_WEB_STRENGTH * cosmic), 0, 1);
  const occupied = rng() < occupancy;
  if (!home && !occupied)
    return null;

  const cell = GALAXY_CELL_LY * AU_PER_LY;
  const type = drawType(rng(), cosmic);
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
  const blackHoleSpin = rng();
  const blackHoleEddingtonRatio = 10 ** lerp(-6, 0, rng() ** 3);

  const { human: humanName, scientific: galaxyName } = nameGalaxy(hash);
  return {
    name: galaxyName,
    arms,
    armStrength: GALAXY_ARM_STRENGTH,
    blackHoleEddingtonRatio,
    blackHoleMass,
    blackHoleSpin,
    centerX,
    centerY,
    cosmicDensity: cosmic,
    dwarf,
    ellipticity,
    humanName,
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

// M–σ relation (Gültekin et al. 2009): log(M_BH/M☉) = 8.12 + 4.24·log(σ/200).
const MSIGMA_INTERCEPT = 8.12;
const MSIGMA_SLOPE = 4.24;
const MSIGMA_SIGMA0 = 200; // km/s

/**
 * Stellar velocity dispersion (km/s), inverting the M–σ relation from the
 * central black-hole mass: heavier holes inhabit galaxies with deeper, faster
 * potential wells. A 10^8.12 M☉ hole gives the 200 km/s pivot.
 */
export function velocityDispersion(blackHoleMass: number): number {
  return MSIGMA_SIGMA0 * 10 ** ((Math.log10(blackHoleMass) - MSIGMA_INTERCEPT) / MSIGMA_SLOPE);
}

/**
 * Cosmic-web environment label from the stored `cosmicDensity` overdensity in
 * `[0, 1]`: empty voids, sheet-like walls, dense filaments, and the cluster
 * nodes where filaments meet.
 */
export function environmentClass(cosmicDensity: number): string {
  if (cosmicDensity < 0.3)
    return 'Void';
  if (cosmicDensity < 0.5)
    return 'Wall';
  if (cosmicDensity < 0.7)
    return 'Filament';
  return 'Cluster';
}

// Per-seed age of the universe: an independent hash of the world seed mapped to
// 8–18 Gyr (ours is ~13.8). Kept off the rng stream so it never perturbs body
// draws — it only shifts values (the stellar age ceiling and enrichment).
const UNIVERSE_AGE_SALT = 0x1F123BB5;
const UNIVERSE_AGE_MIN_YEARS = 8e9;
const UNIVERSE_AGE_MAX_YEARS = 18e9;

/**
 * Per-seed age of the universe (years), drawn from an independent hash of the
 * world seed (8–18 Gyr). Independent of the rng stream, so it never perturbs
 * body draws — it only shifts values: a young universe is metal-poor and
 * planet-sparse, an old one enriched and remnant-heavy (research §7.1).
 */
export function universeAge(worldSeed: number): number {
  const u = hashGalaxy((worldSeed ^ UNIVERSE_AGE_SALT) >>> 0, 0, 0) / 4294967296;
  return lerp(UNIVERSE_AGE_MIN_YEARS, UNIVERSE_AGE_MAX_YEARS, u);
}

// Mean stellar mass (M☉) of a Kroupa IMF, and the specific star-formation rate
// (M☉/yr per M☉ of stars) of a fully star-forming disc.
const MEAN_STELLAR_MASS = 0.4;
const SFR_SPECIFIC = 1e-10;

/** A galaxy's total stellar mass (M☉): its star count times the mean stellar mass. */
export function galaxyStellarMass(g: GalaxyParams): number {
  return estimatedStarCount(g) * MEAN_STELLAR_MASS;
}

/** Star-formation rate (M☉/yr): stellar mass scaled by its population activity. */
export function starFormationRate(g: GalaxyParams): number {
  return galaxyStellarMass(g) * galaxyRepresentativeActivity(g) * SFR_SPECIFIC;
}

/** Mean stellar age (Gyr) by morphology: spheroidals are old, discs younger. */
export function meanStellarAge(g: GalaxyParams): number {
  if (g.type === 'elliptical' || g.type === 'lenticular')
    return 10;
  if (g.type === 'barred-spiral')
    return 6;
  return 5;
}

/** Cold-gas mass fraction by morphology: spirals are gas-rich, early-types poor. */
export function gasFraction(g: GalaxyParams): number {
  if (g.type === 'elliptical')
    return 0.02;
  if (g.type === 'lenticular')
    return 0.05;
  if (g.type === 'barred-spiral')
    return 0.12;
  return 0.15;
}
