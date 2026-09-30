/**
 * Cloud layer (docs/plans/planet-surfaces.md Phase 4): a lit, translucent shell
 * just above a rocky planet's surface. The cloud pattern is domain-warped fBM
 * (the swirl of weather systems), compressed in latitude so clouds stream
 * east–west, thresholded to the family's coverage, over an optional uniform
 * haze for total overcast. Baked once per planet like the surfaces; the star
 * light shades it, so the night side and terminator come for free.
 */

import type { Node } from 'three/webgpu';

import type { CloudLook } from './planet-surface';

import { Color, Vector3 } from 'three';
import { max, mx_fractal_noise_float, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { CLOUD_ALTITUDE, CLOUD_MAP_WIDTH } from '../../config/render';
import { createSurfaceBake } from './surface-bake';

const WARP_OCTAVES = 4;
const CLOUD_OCTAVES = 6;
/** Brightness kept in the thinnest part of a cloud (denser cores read brighter). */
const SHADE_FLOOR = 0.8;

const SCRATCH = new Color();

export interface CloudMaterialHandle {
  material: MeshStandardNodeMaterial;
  dispose: () => void;
  /**
   * Apply a family's look for a planet (`seed` varies the pattern); returns the
   * shell radius in planet radii. Re-bakes only when look or seed change.
   */
  setClouds: (look: CloudLook, seed: number) => number;
}

export function createCloudMaterial(): CloudMaterialHandle {
  const uColor = uniform(new Vector3(1, 1, 1));
  const uCoverage = uniform(0.5);
  const uHaze = uniform(0);
  const uScale = uniform(3);
  const uSoftness = uniform(0.1);
  const uStretch = uniform(1);
  const uSwirl = uniform(1);
  const uSeed = uniform(0);

  const sample = (dir: Node<'vec3'>): Node<'vec4'> => {
    const seed = vec3(uSeed.mul(1.1), uSeed.mul(0.6), uSeed.mul(1.7));
    const p = vec3(dir.x, dir.y.mul(uStretch), dir.z).mul(uScale).add(seed);
    const warp = vec3(
      mx_fractal_noise_float(p, WARP_OCTAVES, 2, 0.5),
      mx_fractal_noise_float(p.add(vec3(5.2, 1.3, 2.8)), WARP_OCTAVES, 2, 0.5),
      mx_fractal_noise_float(p.add(vec3(1.7, 9.2, 4.1)), WARP_OCTAVES, 2, 0.5),
    );
    const density = mx_fractal_noise_float(p.add(warp.mul(uSwirl)), CLOUD_OCTAVES, 2, 0.5).mul(0.5).add(0.5);
    const threshold = uCoverage.oneMinus();
    const pattern = smoothstep(threshold.sub(uSoftness), threshold.add(uSoftness), density);
    return vec4(uColor.mul(density.mul(1 - SHADE_FLOOR).add(SHADE_FLOOR)), max(pattern, uHaze));
  };

  const bake = createSurfaceBake({ sample }, CLOUD_MAP_WIDTH);
  const material = new MeshStandardNodeMaterial({ depthWrite: false, metalness: 0, roughness: 1, transparent: true });
  material.colorNode = bake.node.rgb;
  material.opacityNode = bake.node.a;

  let key = '';
  return {
    material,
    dispose: () => {
      bake.dispose();
      material.dispose();
    },
    setClouds: (look, seed) => {
      SCRATCH.set(look.color);
      uColor.value.set(SCRATCH.r, SCRATCH.g, SCRATCH.b);
      uCoverage.value = look.coverage;
      uHaze.value = look.haze;
      uScale.value = look.scale;
      uSoftness.value = Math.max(look.softness, 1e-3);
      uStretch.value = look.stretch;
      uSwirl.value = look.swirl;
      uSeed.value = seed;
      const next = `${seed}|${look.color}|${look.coverage}|${look.haze}|${look.scale}|${look.softness}|${look.stretch}|${look.swirl}`;
      if (next !== key) {
        key = next;
        bake.invalidate();
      }
      return 1 + CLOUD_ALTITUDE;
    },
  };
}
