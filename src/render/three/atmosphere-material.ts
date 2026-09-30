/**
 * Atmosphere rim glow (docs/plans/planet-surfaces.md Phase 1): an additive shell
 * around the planet, slightly larger than it, so the glow can extend past the
 * silhouette. Per fragment it finds the sight line's closest approach to the
 * planet centre and shades by the atmosphere column along it
 * (`atmosphereColumn` in `planet-surface.ts`), lit only where that part of the
 * atmosphere faces the star.
 *
 * The shell mesh shares the planet's orientation and (oblate) scale times
 * `shellRadius`, so all maths runs in the planet's local frame where the planet
 * is exactly the unit sphere.
 */

import type { AtmosphereLook } from './planet-surface';

import { Color, Vector3 } from 'three';
import { cameraPosition, exp, max, modelWorldMatrixInverse, positionLocal, select, smoothstep, sqrt, uniform, vec4 } from 'three/tsl';
import { AdditiveBlending, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu';

import { shellRadius } from './planet-surface';

/** Scratch colour for parsing hex tints without allocating. */
const SCRATCH_COLOR = new Color();

/** Where the lit side reaches full glow, as a cosine past the terminator. */
const FULL_GLOW_COS = 0.35;

export interface AtmosphereMaterialHandle {
  material: MeshBasicNodeMaterial;
  dispose: () => void;
  /** The star light lighting this planet (render-frame position + colour). */
  setLight: (position: Vector3, color: Color) => void;
  /** Apply a family's look; returns the shell radius (planet radii) to scale the mesh by. */
  setLook: (look: AtmosphereLook) => number;
}

export function createAtmosphereMaterial(): AtmosphereMaterialHandle {
  const uShell = uniform(1.1);
  const uScaleHeight = uniform(0.03);
  const uIntensity = uniform(1);
  const uTwilight = uniform(0.2);
  const uTint = uniform(new Vector3(1, 1, 1));
  const uLightColor = uniform(new Vector3(1, 1, 1));
  const uLightPos = uniform(new Vector3());

  // Local frame scaled so the planet is the unit sphere (the shell geometry is
  // the unit sphere scaled by `uShell` relative to the planet).
  const toLocal = (world: typeof cameraPosition) => modelWorldMatrixInverse.mul(vec4(world, 1)).xyz.mul(uShell);
  const p = positionLocal.mul(uShell);
  const view = p.sub(toLocal(cameraPosition)).normalize();
  const along = p.dot(view);
  const closest = p.sub(view.mul(along));
  const d = closest.length();

  const limbColumn = exp(d.sub(1).div(uScaleHeight).negate());
  const cosZenith = sqrt(max(d.mul(d).oneMinus(), 1e-4));
  const discColumn = sqrt(uScaleHeight.div(Math.PI * 2)).div(cosZenith).min(1);
  const column = select(d.greaterThanEqual(1), limbColumn, discColumn);

  // The air being looked through: at the tangent point past the limb, or where
  // the sight line enters the planet across the disc.
  const entry = p.add(view.mul(along.negate().sub(cosZenith)));
  const airNormal = select(d.greaterThanEqual(1), closest.div(max(d, 1e-4)), entry).normalize();
  const toLight = toLocal(uLightPos).normalize();
  const lit = smoothstep(uTwilight.negate(), FULL_GLOW_COS, airNormal.dot(toLight));

  const material = new MeshBasicNodeMaterial({ blending: AdditiveBlending, depthWrite: false, side: FrontSide, transparent: true });
  material.colorNode = uTint.mul(uLightColor).mul(column.mul(lit).mul(uIntensity));

  return {
    material,
    dispose: () => material.dispose(),
    setLight: (position, color) => {
      uLightPos.value.copy(position);
      uLightColor.value.set(color.r, color.g, color.b);
    },
    setLook: (look) => {
      const shell = shellRadius(look.scaleHeight);
      uShell.value = shell;
      uScaleHeight.value = Math.max(look.scaleHeight, 1e-4);
      uIntensity.value = look.intensity;
      uTwilight.value = look.twilight;
      SCRATCH_COLOR.set(look.tint);
      uTint.value.set(SCRATCH_COLOR.r, SCRATCH_COLOR.g, SCRATCH_COLOR.b);
      return shell;
    },
  };
}
