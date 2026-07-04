/**
 * Procedural star-surface shading (Stage 2, R2 — see docs/plans/star-shading.md).
 *
 * A star is a real sphere, but a flat self-lit fill makes it read as a disc from
 * any angle. This builds a TSL node material (WebGPU path, WebGL2 fallback) that
 * restores the "sphere" cues a real star shows: limb darkening + slight
 * reddening toward the edge, a mottled granulation/starspot surface, and a very
 * gentle flicker. Every parameter is derived from the star's already-computed
 * `StarPhysical` data, so the universe stays byte-identical (purely visual).
 */

import { Color, Vector3 } from 'three';
import { mix, mx_fractal_noise_float, normalView, positionLocal, positionViewDirection, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import { starSurfaceParams } from './star-surface';

/** Scratch colour reused to parse hex strings without per-frame allocation. */
const SCRATCH_COLOR = new Color();

/** A star material plus the setters the renderer uses to drive it per frame. */
export interface StarMaterialHandle {
  material: MeshBasicNodeMaterial;
  dispose: () => void;
  /** Assign the star being drawn: base blackbody colour + temperature look. */
  setStar: (colorHex: string, temperature: number) => void;
  /** Advance the wall-clock time (seconds) driving flicker + granulation drift. */
  setTime: (seconds: number) => void;
}

/**
 * Build a self-lit star material whose surface is shaded from the star's data.
 * One handle per star mesh (systems hold only a few stars); the renderer calls
 * `setStar` when (re)assigning a mesh and `setTime` every frame.
 *
 * `emissiveStrength` (≥ 1) boosts the output into HDR so the star's core exceeds
 * the post-process bloom threshold (giving it a corona) while lit planets, which
 * stay near [0,1], mostly do not.
 */
export function createStarMaterial(emissiveStrength = 1): StarMaterialHandle {
  const uColor = uniform(new Vector3(1, 1, 1));
  const uTime = uniform(0);
  const uLimb = uniform(0.6);
  const uGranScale = uniform(6);
  const uGranContrast = uniform(0.12);
  const uSpot = uniform(0.15);

  // μ = cos(angle between surface normal and view direction): ~1 at the disc
  // centre, ~0 at the limb. This is the view-dependent cue a baked texture
  // cannot provide, and the only thing that makes a self-lit ball look round.
  const mu = normalView.dot(positionViewDirection).clamp(0, 1);
  const limb = uLimb.mul(mu.oneMinus()).oneMinus();

  // Anisotropic drift so the boiling surface never looks like it slides uniformly.
  const drift = vec3(uTime.mul(0.05), uTime.mul(0.03), uTime.mul(-0.04));
  const granule = mx_fractal_noise_float(positionLocal.mul(uGranScale).add(drift), 4);
  const granuleFactor = granule.mul(uGranContrast).add(1);

  // Lower-frequency field thresholded into darker starspot patches.
  const spotField = mx_fractal_noise_float(positionLocal.mul(uGranScale.mul(0.4)).sub(drift), 3);
  const spotFactor = smoothstep(0.2, 0.6, spotField).mul(uSpot).oneMinus();

  // Two incommensurate low frequencies → a subtle, non-repeating shimmer.
  const flicker = sin(uTime.mul(3.1)).mul(0.012).add(sin(uTime.mul(7.3)).mul(0.006)).add(1);

  const brightness = limb.mul(granuleFactor).mul(spotFactor).mul(flicker);
  // Redden toward the limb (more cool atmosphere along the sightline there).
  const tint = mix(vec3(1, 0.82, 0.6), vec3(1, 1, 1), mu.pow(0.6));

  const material = new MeshBasicNodeMaterial();
  material.colorNode = uColor.mul(tint).mul(brightness).mul(emissiveStrength);

  return {
    material,
    dispose: () => material.dispose(),
    setStar: (colorHex, temperature) => {
      // ColorManagement is disabled globally, so Color holds raw sRGB [0,1].
      SCRATCH_COLOR.set(colorHex);
      uColor.value.set(SCRATCH_COLOR.r, SCRATCH_COLOR.g, SCRATCH_COLOR.b);
      const params = starSurfaceParams(temperature);
      uLimb.value = params.limbDarkening;
      uGranScale.value = params.granulationScale;
      uGranContrast.value = params.granulationContrast;
      uSpot.value = params.spotIntensity;
    },
    setTime: (seconds) => {
      uTime.value = seconds;
    },
  };
}
