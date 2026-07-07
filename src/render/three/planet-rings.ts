/**
 * Procedural planet rings (Stage 2 / workstream G — see
 * docs/plans/planet-rings.md). A translucent ring disc for planets flagged
 * `hasRings`, lying in the planet's equatorial plane (oriented by the renderer)
 * and scaled to the planet.
 *
 * Iteration 2 adds lighting + identity: the ring is star-lit (near-uniform,
 * since ring particles scatter light from any angle) with the planet's **shadow
 * band** carved across it (the iconic Saturn cue), and its colour comes from the
 * planet's temperature (icy white/blue when cold → dusty tan/red when warm). The
 * base look is still an analytic **radial** profile (soft edges, one gap, faint
 * sub-bands) — no noise, no animation. All from existing data, so the universe
 * stays byte-identical; each ringed planet gets its own material handle so its
 * colour / centre / star direction can be set per frame.
 */

import { Vector3 } from 'three';
import { cos, positionLocal, positionWorld, smoothstep, step, uniform } from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

import { clamp } from './star-surface';

/** A raw sRGB colour triple in [0, 1] (ColorManagement is disabled globally). */
type Rgb = [number, number, number];

/**
 * Inner edge of the ring as a fraction of its outer radius. The shared geometry
 * is a unit ring spanning `[RING_INNER_FRAC, 1]`; each ring mesh is scaled by its
 * world outer radius, so the profile is identical and only the size varies.
 */
export const RING_INNER_FRAC = 0.55;
/** Radial resolution of the ring annulus. */
export const RING_SEGMENTS = 96;

// Outer radius as a multiple of the planet's drawn radius (Saturn's rings reach
// ~2.3 R). Varies a little per planet for variety.
const RING_OUTER_MIN = 1.9;
const RING_OUTER_MAX = 2.4;
// Soft inner/outer edge width, in normalized [0,1] across the ring.
const EDGE_SOFT = 0.12;
// One Cassini-style gap: centre, half-width, and softness (normalized [0,1]).
const GAP_CENTER = 0.42;
const GAP_HALF = 0.05;
const GAP_SOFT = 0.04;
// Faint concentric sub-bands for a little texture (count + brightness swing).
const BAND_COUNT = 5;
const BAND_CONTRAST = 0.12;
// Peak (translucent) ring opacity.
const RING_OPACITY = 0.55;
// Residual brightness inside the planet's shadow band (0 = black).
const SHADOW_DARK = 0.12;
// Fraction of the planet radius that is fully shadowed (softens to 1·R at the edge).
const SHADOW_CORE = 0.7;

// Temperature-driven ring palette (raw sRGB): cold icy worlds → bright blue-white
// ices; warmer / rocky worlds → dusty tan then reddish rock.
const RING_ICY: Rgb = [0.82, 0.86, 0.92];
const RING_TAN: Rgb = [0.80, 0.72, 0.58];
const RING_DUSTY: Rgb = [0.62, 0.46, 0.36];
const RING_COLD_T = 80;
const RING_WARM_T = 250;
const RING_HOT_T = 500;

/** Component-wise linear interpolation between two colours. */
function lerp3(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * A stable per-planet variety value in [0, 1) hashed from two physical numbers
 * (e.g. mass + equilibrium temperature) — derived from existing data, so it
 * consumes no RNG draw and the universe stays byte-identical.
 */
export function ringVariety(a: number, b: number): number {
  const s = Math.sin(a * 45.233 + b * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Ring outer radius (world units) from the planet's drawn radius + variety. */
export function ringOuterRadius(planetRadiusWorld: number, variety: number): number {
  return planetRadiusWorld * (RING_OUTER_MIN + (RING_OUTER_MAX - RING_OUTER_MIN) * variety);
}

/**
 * Ring colour from the planet's equilibrium temperature: bright icy blue-white
 * when cold, through dusty tan, to reddish rock when warm.
 */
export function ringColor(equilibriumTemp: number): Rgb {
  if (equilibriumTemp <= RING_WARM_T) {
    const t = clamp((equilibriumTemp - RING_COLD_T) / (RING_WARM_T - RING_COLD_T), 0, 1);
    return lerp3(RING_ICY, RING_TAN, t);
  }
  const t = clamp((equilibriumTemp - RING_WARM_T) / (RING_HOT_T - RING_WARM_T), 0, 1);
  return lerp3(RING_TAN, RING_DUSTY, t);
}

/** A ring material plus the per-frame setter the renderer drives it with. */
export interface RingMaterialHandle {
  material: MeshBasicNodeMaterial;
  dispose: () => void;
  /**
   * Assign the ringed planet: its world centre + drawn radius, the star's world
   * position (for the shadow band; `shadowEnable` 0 disables it), and the ring
   * colour.
   */
  setRing: (center: Vector3, planetRadius: number, star: Vector3, shadowEnable: number, color: Rgb) => void;
}

/**
 * Build a ring material for one planet — an analytic radial profile on a unit
 * ring in its local XY plane (`positionLocal.xy` radius), star-lit with the
 * planet's shadow band carved across it. One handle per ringed planet (systems
 * hold only a few); the renderer calls `setRing` each frame.
 */
export function createRingMaterial(): RingMaterialHandle {
  const uColor = uniform(new Vector3(0.78, 0.72, 0.6));
  const uPlanetCenter = uniform(new Vector3());
  const uStarPos = uniform(new Vector3(0, 0, 1));
  const uPlanetRadius = uniform(1);
  const uShadowEnable = uniform(0);

  // Normalized radius t across the ring width [RING_INNER_FRAC, 1] → [0, 1].
  const r = positionLocal.xy.length();
  const t = r.sub(RING_INNER_FRAC).div(1 - RING_INNER_FRAC).clamp(0, 1);

  // Fade the inner and outer edges to nothing.
  const innerFade = smoothstep(0, EDGE_SOFT, t);
  const outerFade = smoothstep(1 - EDGE_SOFT, 1, t).oneMinus();
  // Carve one gap: opacity drops to zero within GAP_HALF of the gap centre.
  const gapFade = smoothstep(GAP_HALF, GAP_HALF + GAP_SOFT, t.sub(GAP_CENTER).abs());
  const opacity = innerFade.mul(outerFade).mul(gapFade).mul(RING_OPACITY);

  // Faint concentric sub-bands modulate brightness only.
  const bands = cos(t.mul(Math.PI * 2 * BAND_COUNT)).mul(0.5).add(0.5).mul(BAND_CONTRAST).add(1 - BAND_CONTRAST);

  // Planet shadow band (cylindrical approximation — the star is effectively at
  // infinity). A fragment is shadowed when it lies behind the planet (away from
  // the star) and within the planet's silhouette (perpendicular distance from
  // the shadow axis < planet radius).
  const toFrag = positionWorld.sub(uPlanetCenter);
  const lightDir = uStarPos.sub(uPlanetCenter).normalize();
  const along = toFrag.dot(lightDir);
  const perp = toFrag.sub(lightDir.mul(along)).length();
  const behind = step(0, along.mul(-1));
  const inSilhouette = smoothstep(uPlanetRadius.mul(SHADOW_CORE), uPlanetRadius, perp).oneMinus();
  const shadow = behind.mul(inSilhouette).mul(uShadowEnable);
  const shadowMul = shadow.mul(1 - SHADOW_DARK).oneMinus();

  const material = new MeshBasicNodeMaterial({ transparent: true });
  material.colorNode = uColor.mul(bands).mul(shadowMul);
  material.opacityNode = opacity;
  material.depthWrite = false;
  material.side = DoubleSide;

  return {
    material,
    dispose: () => material.dispose(),
    setRing: (center, planetRadius, star, shadowEnable, color) => {
      uColor.value.set(color[0], color[1], color[2]);
      uPlanetCenter.value.copy(center);
      uStarPos.value.copy(star);
      uPlanetRadius.value = planetRadius;
      uShadowEnable.value = shadowEnable;
    },
  };
}
