/**
 * Procedural planet rings (Stage 2 / workstream G — see
 * docs/plans/planet-rings.md). A translucent ring disc for planets flagged
 * `hasRings`, lying in the planet's equatorial plane (oriented by the renderer)
 * and scaled to the planet.
 *
 * The look is deliberately simple and objective: a flat, translucent annulus
 * with an analytic **radial** profile — soft inner/outer edges, one Cassini-style
 * gap, and faint concentric sub-bands — in a subtle icy tan-grey. No noise, no
 * animation. Everything derives from existing data (planet radius + a hash for a
 * little per-planet size variety), so the universe stays byte-identical.
 */

import { Vector3 } from 'three';
import { cos, positionLocal, smoothstep, uniform } from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

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
// Subtle icy tan-grey (raw sRGB; ColorManagement is disabled globally).
const RING_COLOR = new Vector3(0.78, 0.72, 0.6);

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
 * Build the shared translucent ring material — an analytic radial profile on a
 * unit ring in its local XY plane (`positionLocal.xy` radius). One instance is
 * reused for every ring mesh (they all look the same; only their size differs).
 */
export function createRingMaterial(): MeshBasicNodeMaterial {
  const uColor = uniform(RING_COLOR);

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

  const material = new MeshBasicNodeMaterial({ transparent: true });
  material.colorNode = uColor.mul(bands);
  material.opacityNode = opacity;
  material.depthWrite = false;
  material.side = DoubleSide;
  return material;
}
