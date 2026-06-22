import { lerp } from '@pierre/ecs/modules/math';
import { makeSeededRng, randomInt } from '@pierre/ecs/modules/rng';

import {
  GALAXY_ARM_PITCH_DEG,
  GALAXY_ARM_STRENGTH,
  GALAXY_ARMS_MAX,
  GALAXY_ARMS_MIN,
  GALAXY_RADIUS_LY,
  GALAXY_SCALE_LENGTH_LY,
  GALAXY_SPIRAL_CHANCE,
} from '../config';
import { hashGalaxy } from './hash';
import { AU_PER_LY } from './units';

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
// Exponent that sharpens the spiral arms (higher = thinner, brighter arms).
const ARM_SHARPNESS = 2;
// Central bulge e-folding length as a fraction of the disc scale length: a tight
// bright core that fills the centre where the logarithmic arms would otherwise
// oscillate, so the galaxy's heart is always dense (no empty startup sector).
const BULGE_SCALE = 0.15;

/** Broad galaxy morphology: a flat disc with arms, or a smooth ellipsoid. */
export type GalaxyType = 'elliptical' | 'spiral';

/**
 * Seeded shape of a single galaxy, all derived once from the world seed. Lengths
 * are in AU (the world unit). The galaxy is centred on the world origin in v1;
 * Phase G will place many galaxies via `hashGalaxy(galaxyIndex)`.
 */
export interface GalaxyParams {
  arms: number;
  armStrength: number;
  ellipticity: number;
  orientation: number;
  phase: number;
  pitch: number;
  radius: number;
  scaleLength: number;
  type: GalaxyType;
}

/** Derive a galaxy's shape parameters from the world seed (pure, deterministic). */
export function makeGalaxy(worldSeed: number): GalaxyParams {
  const rng = makeSeededRng(hashGalaxy(worldSeed));
  // Draw into locals in a fixed order so the deterministic stream never shifts,
  // independent of how eslint sorts the returned object's keys.
  const type: GalaxyType = rng() < GALAXY_SPIRAL_CHANCE ? 'spiral' : 'elliptical';
  const arms = GALAXY_ARMS_MIN + randomInt(GALAXY_ARMS_MAX - GALAXY_ARMS_MIN + 1, rng);
  const ellipticity = type === 'elliptical' ? lerp(0.5, 0.85, rng()) : 1;
  const orientation = rng() * TAU;
  const phase = rng() * TAU;
  return {
    arms,
    armStrength: GALAXY_ARM_STRENGTH,
    ellipticity,
    orientation,
    phase,
    pitch: GALAXY_ARM_PITCH_DEG * DEG_TO_RAD,
    radius: GALAXY_RADIUS_LY * AU_PER_LY,
    scaleLength: GALAXY_SCALE_LENGTH_LY * AU_PER_LY,
    type,
  };
}

let memoSeed: number | null = null;
let memoGalaxy: GalaxyParams | null = null;

/**
 * The current world's galaxy, memoised by seed. Generation and the galaxy-tier
 * glow both call this every sector / frame, so caching avoids recomputing the
 * shape on the hot path (the world seed is constant for a session).
 */
export function getGalaxy(worldSeed: number): GalaxyParams {
  if (memoSeed !== worldSeed || !memoGalaxy) {
    memoSeed = worldSeed;
    memoGalaxy = makeGalaxy(worldSeed);
  }
  return memoGalaxy;
}

/**
 * Normalised star density at world point `(x, y)` for this galaxy, in `[0, 1]`
 * (1 at the core, 0 beyond the rim). An exponential disc gives the radial
 * falloff; spiral galaxies multiply in a logarithmic-arm pattern plus a central
 * bulge, while ellipticals use an ellipse-squashed radius with no arms. Used as
 * the keep-probability for star placement and the brightness of the zoomed-out
 * glow, so both tiers show the same shape.
 */
export function galaxyDensity(g: GalaxyParams, x: number, y: number): number {
  // Rotate into the galaxy's principal frame.
  const cosO = Math.cos(g.orientation);
  const sinO = Math.sin(g.orientation);
  const xr = x * cosO + y * sinO;
  const yr = -x * sinO + y * cosO;

  if (g.type === 'elliptical') {
    const rEff = Math.hypot(xr, yr / g.ellipticity);
    if (rEff > g.radius)
      return 0;
    return Math.exp(-rEff / g.scaleLength);
  }

  const r = Math.hypot(xr, yr);
  if (r > g.radius)
    return 0;
  const radial = Math.exp(-r / g.scaleLength);
  const bulge = Math.exp(-r / (g.scaleLength * BULGE_SCALE));
  if (r === 0)
    return 1;
  const theta = Math.atan2(yr, xr);
  const armPhase = g.arms * (theta - Math.log(r) / Math.tan(g.pitch)) - g.phase;
  const arm = (0.5 + 0.5 * Math.cos(armPhase)) ** ARM_SHARPNESS;
  const armFactor = 1 - g.armStrength + g.armStrength * arm;
  return Math.min(1, bulge + radial * armFactor);
}
