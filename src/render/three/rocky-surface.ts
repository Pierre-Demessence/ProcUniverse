/**
 * Rocky / super-Earth surface (docs/plans/planet-surfaces.md Phase 2): smooth
 * fBM terrain, bowl-and-rim craters, oceans below a sea level, latitude ice caps
 * with a noisy edge, and lava glowing in the lowlands of molten worlds. Global
 * knobs come from `RockyTuning`, per-planet inputs from `rockyRegime`; the
 * result is baked once per planet (albedo + height) and lit by the star.
 */

import type { Node, UniformNode } from 'three/webgpu';

import type { RockyRegime, RockyTuning } from './planet-surface';
import type { PlanetSurface } from './surface-bake';

import { Color, Vector3 } from 'three';
import { exp, float, floor, mix, mx_cell_noise_float, mx_fractal_noise_float, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';

/** Rim height relative to bowl depth, and rim width in crater radii. */
const RIM_HEIGHT = 0.35;
const RIM_WIDTH = 0.22;
/** A second, finer crater layer: this many times the base frequency, at this share of the depth. */
const SMALL_CRATER_FREQ = 2.7;
const SMALL_CRATER_DEPTH = 0.5;
/** Lowland/highland colour blend band over the height field. */
const LAND_BLEND_LOW = 0.25;
const LAND_BLEND_HIGH = 0.85;
/** Height band below sea level that fades deep water to shallow. */
const SHELF_DEPTH = 0.15;
const CAP_EDGE_SOFTNESS = 0.03;
const LAVA_EDGE = 0.1;

const SCRATCH = new Color();

type Vec3Uniform = UniformNode<'vec3', Vector3>;
type FloatUniform = UniformNode<'float', number>;

function setColor(target: Vec3Uniform, hex: string): void {
  SCRATCH.set(hex);
  target.value.set(SCRATCH.r, SCRATCH.g, SCRATCH.b);
}

/** Integer-offset variant of a cell so each cell rolls several independent randoms. */
function roll(cell: Node<'vec3'>, x: number, y: number, z: number): Node<'float'> {
  return float(mx_cell_noise_float(cell.add(vec3(x, y, z))));
}

/**
 * Sum of crater profiles from the 27 cells around `p` (unrolled: this runs only
 * when a map is baked). Each cell holds a crater with probability `density`, at
 * a jittered centre, with a random radius up to `size` cells; its profile is a
 * parabolic bowl plus a Gaussian rim, scaled by radius so big craters are deeper.
 */
function craterField(p: Node<'vec3'>, density: FloatUniform, size: FloatUniform): Node<'float'> {
  const base = floor(p);
  let total: Node<'float'> = float(0);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = base.add(vec3(dx, dy, dz));
        const centre = cell.add(vec3(roll(cell, 0, 0, 0), roll(cell, 71, 0, 0), roll(cell, 0, 113, 0)));
        const radius = size.mul(roll(cell, 211, 0, 0).mul(0.7).add(0.3));
        const present = step(roll(cell, 0, 0, 157), density);
        const r = p.sub(centre).length().div(radius);
        const bowl = r.mul(r).oneMinus().max(0).negate();
        const t = r.sub(1).div(RIM_WIDTH);
        const rim = exp(t.mul(t).negate()).mul(RIM_HEIGHT);
        total = total.add(bowl.add(rim).mul(radius).mul(present));
      }
    }
  }
  return total;
}

export interface RockySurface {
  surface: PlanetSurface;
  /** Push tuning + this planet's regime into the shader's uniforms. */
  set: (tuning: RockyTuning, regime: RockyRegime) => void;
}

export function createRockySurface(): RockySurface {
  const uLow = uniform(new Vector3());
  const uHigh = uniform(new Vector3());
  const uDeep = uniform(new Vector3());
  const uShallow = uniform(new Vector3());
  const uCap = uniform(new Vector3());
  const uLava = uniform(new Vector3());
  const uContinentScale = uniform(1);
  const uOctaves = uniform(1);
  const uDiminish = uniform(0.5);
  const uCraterScale = uniform(1);
  const uCraterDensity = uniform(0);
  const uCraterSize = uniform(0.3);
  const uCraterDepth = uniform(0);
  const uCraters = uniform(0);
  const uSea = uniform(0.5);
  const uOcean = uniform(0);
  const uCapStart = uniform(2);
  const uCapNoise = uniform(0);
  const uMolten = uniform(0);
  const uLavaLevel = uniform(0.4);
  const uRelief = uniform(0);
  const uSeed = uniform(0);

  const sample = (dir: Node<'vec3'>): Node<'vec4'> => {
    const seed = vec3(uSeed, uSeed.mul(0.7), uSeed.mul(1.3));
    const terrain = mx_fractal_noise_float(dir.mul(uContinentScale).add(seed), uOctaves, 2, uDiminish).mul(0.5).add(0.5);
    const craterP = dir.mul(uCraterScale).add(seed);
    const craters = craterField(craterP, uCraterDensity, uCraterSize)
      .add(craterField(craterP.mul(SMALL_CRATER_FREQ), uCraterDensity, uCraterSize).mul(SMALL_CRATER_DEPTH));
    const h = terrain.add(craters.mul(uCraterDepth).mul(uCraters)).clamp(0, 1);

    const land = mix(uLow, uHigh, smoothstep(LAND_BLEND_LOW, LAND_BLEND_HIGH, h));
    const underwater = uOcean.mul(step(h, uSea));
    const water = mix(uDeep, uShallow, smoothstep(uSea.sub(SHELF_DEPTH), uSea, h));
    const ground = mix(land, water, underwater);
    const surfaceHeight = mix(h, uSea, underwater);

    const capWobble = mx_fractal_noise_float(dir.mul(3).add(seed.mul(1.7)), 3, 2, 0.5).mul(uCapNoise);
    const cap = smoothstep(uCapStart, uCapStart.add(CAP_EDGE_SOFTNESS), dir.y.abs().add(capWobble));
    return vec4(mix(ground, uCap, cap), surfaceHeight);
  };

  const emissive = (sampled: Node<'vec4'>): Node<'vec3'> =>
    uLava.mul(uMolten).mul(smoothstep(uLavaLevel.sub(LAVA_EDGE), uLavaLevel, sampled.a).oneMinus());

  return {
    surface: { emissive, relief: uRelief, sample },
    set: (tuning, regime) => {
      uLow.value.set(...regime.low);
      uHigh.value.set(...regime.high);
      setColor(uDeep, tuning.deepColor);
      setColor(uShallow, tuning.shallowColor);
      setColor(uCap, tuning.capColor);
      setColor(uLava, tuning.lavaColor);
      uContinentScale.value = tuning.continentScale;
      uOctaves.value = Math.round(tuning.octaves);
      uDiminish.value = tuning.diminish;
      uCraterScale.value = tuning.craterScale;
      uCraterDensity.value = tuning.craterDensity;
      uCraterSize.value = Math.min(Math.max(tuning.craterSize, 0.05), 0.5);
      uCraterDepth.value = tuning.craterDepth;
      uCraters.value = regime.craters;
      uSea.value = tuning.seaLevel;
      uOcean.value = regime.ocean ? 1 : 0;
      uCapStart.value = regime.capStart;
      uCapNoise.value = tuning.capEdgeNoise;
      uMolten.value = regime.molten;
      uLavaLevel.value = tuning.lavaLevel;
      uRelief.value = tuning.relief;
      uSeed.value = regime.seed;
    },
  };
}
