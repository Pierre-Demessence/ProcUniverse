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
import { positionLocal, positionWorld, sin, smoothstep, step, uniform } from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

import { clamp } from './star-surface';

/** A raw sRGB colour triple in [0, 1] (ColorManagement is disabled globally). */
type Rgb = [number, number, number];

/**
 * Inner edge of the ring *geometry* as a fraction of its outer radius. The mesh
 * is a unit ring spanning `[RING_INNER_FRAC, 1]`, scaled per planet by its world
 * outer radius; the *visible* inner edge is set higher per planet (see
 * `ringDiversity`), fading out the geometry below it.
 */
export const RING_INNER_FRAC = 0.35;
/** Radial resolution of the ring annulus. */
export const RING_SEGMENTS = 96;

// Outer radius as a multiple of the planet's drawn radius (Saturn's rings reach
// ~2.3 R). Varies a little per planet.
const RING_OUTER_MIN = 1.9;
const RING_OUTER_MAX = 2.4;
// Soft inner/outer edge width, in normalized [0,1] across the ring.
const EDGE_SOFT = 0.1;
// Up to this many Cassini-style gaps per planet; softness of each gap edge.
const MAX_GAPS = 3;
const GAP_SOFT = 0.03;
const GAP_POS_MIN = 0.2;
const GAP_POS_MAX = 0.8;
const GAP_WIDTH_MIN = 0.02;
const GAP_WIDTH_MAX = 0.055;
// Per-planet visible inner edge and peak opacity ranges.
const INNER_MIN = 0.4;
const INNER_MAX = 0.6;
const OPACITY_MIN = 0.4;
const OPACITY_MAX = 0.7;
// Fine static ringlets (radius-only, no time → no grain): frequency + brightness swing.
const RINGLET_FREQ = 60;
const RINGLET_CONTRAST = 0.06;
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

/** A stable hash in [0, 1) of two numbers + a salt (no RNG draw). */
function hash(a: number, b: number, salt: number): number {
  const s = Math.sin(a * 45.233 + b * 12.9898 + salt) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A stable per-planet variety value in [0, 1) hashed from two physical numbers
 * (e.g. mass + equilibrium temperature) — derived from existing data, so it
 * consumes no RNG draw and the universe stays byte-identical.
 */
export function ringVariety(a: number, b: number): number {
  return hash(a, b, 0);
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

/** Per-planet structural variety: gaps, visible inner edge, opacity, ringlet phase. */
export interface RingDiversity {
  /** Gap centres in [0,1] across the ring; `-1` marks an unused slot. */
  gapCenters: [number, number, number];
  /** Gap half-widths (normalized); `0` for unused slots. */
  gapWidths: [number, number, number];
  /** Visible inner edge (fraction of outer radius). */
  innerStart: number;
  /** Peak opacity. */
  opacity: number;
  /** Phase seed in [0,1) for the ringlet pattern. */
  seed: number;
}

/**
 * Derive a planet's ring structure (1–3 gaps at varied positions/widths, a
 * visible inner edge, opacity, and a ringlet phase) from its mass + equilibrium
 * temperature. Pure and stable — no RNG draw — so the universe stays
 * byte-identical.
 */
export function ringDiversity(mass: number, equilibriumTemp: number): RingDiversity {
  const gapCount = 1 + Math.floor(hash(mass, equilibriumTemp, 1) * MAX_GAPS);
  const gapCenters: [number, number, number] = [-1, -1, -1];
  const gapWidths: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < gapCount; i++) {
    gapCenters[i] = GAP_POS_MIN + (GAP_POS_MAX - GAP_POS_MIN) * hash(mass, equilibriumTemp, 10 + i);
    gapWidths[i] = GAP_WIDTH_MIN + (GAP_WIDTH_MAX - GAP_WIDTH_MIN) * hash(mass, equilibriumTemp, 20 + i);
  }
  return {
    gapCenters,
    gapWidths,
    innerStart: INNER_MIN + (INNER_MAX - INNER_MIN) * hash(mass, equilibriumTemp, 2),
    opacity: OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * hash(mass, equilibriumTemp, 3),
    seed: hash(mass, equilibriumTemp, 4),
  };
}

/** A ring material plus the per-frame setter the renderer drives it with. */
export interface RingMaterialHandle {
  material: MeshBasicNodeMaterial;
  dispose: () => void;
  /**
   * Assign the ringed planet: its world centre + drawn radius, the star's world
   * position (for the shadow band; `shadowEnable` 0 disables it), and its mass +
   * equilibrium temperature (which drive the colour and structural variety).
   */
  setRing: (center: Vector3, planetRadius: number, star: Vector3, shadowEnable: number, mass: number, equilibriumTemp: number) => void;
}

/**
 * Build a ring material for one planet — an analytic radial profile on a unit
 * ring in its local XY plane (`positionLocal.xy` radius): a per-planet visible
 * inner edge, 1–3 gaps, fine static ringlets, star-lit with the planet's shadow
 * band carved across it, coloured by temperature. One handle per ringed planet
 * (systems hold only a few); the renderer calls `setRing` each frame.
 */
export function createRingMaterial(): RingMaterialHandle {
  const uColor = uniform(new Vector3(0.78, 0.72, 0.6));
  const uPlanetCenter = uniform(new Vector3());
  const uStarPos = uniform(new Vector3(0, 0, 1));
  const uPlanetRadius = uniform(1);
  const uShadowEnable = uniform(0);
  const uGapCenters = uniform(new Vector3(-1, -1, -1));
  const uGapWidths = uniform(new Vector3());
  const uInnerStart = uniform(0.5);
  const uOpacity = uniform(0.55);
  const uSeed = uniform(0);

  // Normalized radius t across the *visible* ring [innerStart, 1] → [0, 1];
  // geometry below innerStart falls outside [0,1] and fades to nothing.
  const r = positionLocal.xy.length();
  const t = r.sub(uInnerStart).div(uInnerStart.oneMinus()).clamp(0, 1);

  // Fade the inner and outer edges to nothing.
  const innerFade = smoothstep(0, EDGE_SOFT, t);
  const outerFade = smoothstep(1 - EDGE_SOFT, 1, t).oneMinus();
  // Up to three gaps: opacity drops to zero within a gap's half-width of its
  // centre. Unused slots have centre −1 (far outside [0,1]) → no effect.
  const gap0 = smoothstep(uGapWidths.x, uGapWidths.x.add(GAP_SOFT), t.sub(uGapCenters.x).abs());
  const gap1 = smoothstep(uGapWidths.y, uGapWidths.y.add(GAP_SOFT), t.sub(uGapCenters.y).abs());
  const gap2 = smoothstep(uGapWidths.z, uGapWidths.z.add(GAP_SOFT), t.sub(uGapCenters.z).abs());
  const opacity = innerFade.mul(outerFade).mul(gap0).mul(gap1).mul(gap2).mul(uOpacity);

  // Fine static ringlets (radius-only, two incommensurate frequencies → a
  // non-repeating pattern; a per-planet phase differentiates planets). No time,
  // so this can never degrade into grain.
  const phase = uSeed.mul(Math.PI * 2);
  const ringlets = sin(t.mul(RINGLET_FREQ).add(phase)).mul(0.6).add(sin(t.mul(RINGLET_FREQ * 0.37).add(phase.mul(1.7))).mul(0.4)).mul(RINGLET_CONTRAST).add(1);

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
  material.colorNode = uColor.mul(ringlets).mul(shadowMul);
  material.opacityNode = opacity;
  material.depthWrite = false;
  material.side = DoubleSide;

  return {
    material,
    dispose: () => material.dispose(),
    setRing: (center, planetRadius, star, shadowEnable, mass, equilibriumTemp) => {
      const color = ringColor(equilibriumTemp);
      uColor.value.set(color[0], color[1], color[2]);
      const d = ringDiversity(mass, equilibriumTemp);
      uGapCenters.value.set(d.gapCenters[0], d.gapCenters[1], d.gapCenters[2]);
      uGapWidths.value.set(d.gapWidths[0], d.gapWidths[1], d.gapWidths[2]);
      uInnerStart.value = d.innerStart;
      uOpacity.value = d.opacity;
      uSeed.value = d.seed;
      uPlanetCenter.value.copy(center);
      uStarPos.value.copy(star);
      uPlanetRadius.value = planetRadius;
      uShadowEnable.value = shadowEnable;
    },
  };
}
