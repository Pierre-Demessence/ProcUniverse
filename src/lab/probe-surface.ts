/**
 * A throwaway test surface for the planet lab: mottled two-colour noise plus
 * polar caps. It is not a real look — it exists to compare the baked and
 * per-pixel albedo paths (plan §3.2) with detail you can push until it shimmers.
 */

import type { AlbedoFn } from '../render/three/surface-bake';

import { Color } from 'three';
import { mix, mx_fractal_noise_float, smoothstep, uniform, vec3 } from 'three/tsl';

export interface ProbeParams {
  capColor: string;
  capSoftness: number;
  /** |latitude| (as the sphere's y, 0..1) where caps begin. */
  capStart: number;
  contrast: number;
  highColor: string;
  lowColor: string;
  octaves: number;
  /** Noise frequency: larger = finer detail. */
  scale: number;
}

export const PROBE_DEFAULTS: ProbeParams = {
  capColor: '#eef2f5',
  capSoftness: 0.05,
  capStart: 0.85,
  contrast: 1.2,
  highColor: '#b89a74',
  lowColor: '#5a4636',
  octaves: 5,
  scale: 4,
};

export interface ProbeSurface {
  albedo: AlbedoFn;
  set: (params: ProbeParams, varietySeed: number) => void;
}

export function createProbeSurface(): ProbeSurface {
  const uLow = uniform(new Color());
  const uHigh = uniform(new Color());
  const uCap = uniform(new Color());
  const uScale = uniform(1);
  const uOctaves = uniform(1);
  const uContrast = uniform(1);
  const uCapStart = uniform(1);
  const uCapSoftness = uniform(0.05);
  const uSeed = uniform(0);

  const albedo: AlbedoFn = (dir) => {
    const noise = mx_fractal_noise_float(dir.mul(uScale).add(vec3(uSeed, uSeed.mul(0.7), uSeed.mul(1.3))), uOctaves, 2, 0.5);
    const t = noise.mul(uContrast).mul(0.5).add(0.5).clamp(0, 1);
    const ground = mix(uLow, uHigh, t);
    const cap = smoothstep(uCapStart, uCapStart.add(uCapSoftness), dir.y.abs());
    return mix(ground, uCap, cap);
  };

  return {
    albedo,
    set: (params, varietySeed) => {
      uLow.value.set(params.lowColor);
      uHigh.value.set(params.highColor);
      uCap.value.set(params.capColor);
      uScale.value = params.scale;
      uOctaves.value = Math.round(params.octaves);
      uContrast.value = params.contrast;
      uCapStart.value = params.capStart;
      uCapSoftness.value = Math.max(params.capSoftness, 1e-3);
      uSeed.value = varietySeed;
    },
  };
}
