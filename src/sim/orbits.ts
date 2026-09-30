import type { EcsWorld } from '@pierre/ecs';
import type { ComponentDef } from '@pierre/ecs/component-store';

import { simpleComponent } from '@pierre/ecs/component-store';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { KM_PER_AU, SECONDS_PER_YEAR } from '../generation/units';

const TAU = Math.PI * 2;
// One AU per year expressed in km/s, for converting orbital speeds.
const KM_S_PER_AU_YEAR = KM_PER_AU / SECONDS_PER_YEAR;

/**
 * Keplerian orbital elements. A planet's position is a closed-form (analytic)
 * function of a global clock `t`: no N-body integration, so an un-instantiated
 * system's planets are always exactly where the formula says.
 *
 * `cx`/`cy` is the star — the orbit's focus, not its centre — in the render
 * frame; systems are static within their cell for now. `a` is the semi-major
 * axis (AU), `e` the eccentricity (0 = circle), `argPeriapsis` the orientation
 * of the ellipse, `meanAnomaly0` the phase at `t = 0`, and `starMass` the host
 * mass (M☉) that sets the period — heavier stars whip their planets around
 * faster at the same `a`. Periods follow Kepler's third law in solar units, so
 * they come out directly in years.
 *
 * `parent` is −1 for a body orbiting its star at the fixed focus `cx`/`cy`; for a
 * **moon** it is the entity id of its planet, whose current position becomes the
 * focus each frame (and `starMass` then holds the planet's mass, in M☉).
 *
 * `inclination` (i) tilts the orbit out of the reference (z=0) plane and
 * `longitudeAscendingNode` (Ω) swings that tilt around, so the orbit is a genuine
 * 3D ellipse; both are 0 for a flat, top-down orbit. `cz` is the focus's z (0 for
 * a planet around its star, the planet's current z for a moon).
 */
export interface OrbitElements {
  a: number;
  argPeriapsis: number;
  cx: number;
  cy: number;
  cz: number;
  e: number;
  inclination: number;
  longitudeAscendingNode: number;
  meanAnomaly0: number;
  parent: number;
  starMass: number;
}

export const OrbitElementsDef: ComponentDef<OrbitElements> = simpleComponent<OrbitElements>('orbitElements', {
  a: 'number',
  argPeriapsis: 'number',
  cx: 'number',
  cy: 'number',
  cz: 'number',
  e: 'number',
  inclination: 'number',
  longitudeAscendingNode: 'number',
  meanAnomaly0: 'number',
  parent: 'number',
  starMass: 'number',
});

/**
 * Orbital period in **years** for a host mass (M☉) and semi-major axis (AU),
 * straight from Kepler's third law in solar units: `P = sqrt(a³ / M)`. Exported
 * for tests and any caller that needs the period rather than a position.
 */
export function orbitalPeriod(starMass: number, a: number): number {
  return Math.sqrt(a ** 3 / starMass);
}

/** Periapsis distance (AU): the closest approach to the star, `a(1 − e)`. */
export function periapsis(orbit: OrbitElements): number {
  return orbit.a * (1 - orbit.e);
}

/** Apoapsis distance (AU): the farthest point from the star, `a(1 + e)`. */
export function apoapsis(orbit: OrbitElements): number {
  return orbit.a * (1 + orbit.e);
}

/**
 * Mean orbital speed (km/s): the circular-equivalent `2πa/P`, converted from
 * AU/year to km/s. Earth ≈ 29.8 km/s.
 */
export function meanOrbitalSpeed(orbit: OrbitElements): number {
  return ((TAU * orbit.a) / orbitalPeriod(orbit.starMass, orbit.a)) * KM_S_PER_AU_YEAR;
}

/**
 * Insolation swing: the peri-to-apo stellar-flux ratio `((1+e)/(1−e))²` (flux
 * ∝ 1/r²). 1 for a circle; large for eccentric orbits, where it drives the
 * seasonal temperature extremes. Defined for closed ellipses (`e < 1`).
 */
export function insolationSwing(orbit: OrbitElements): number {
  return ((1 + orbit.e) / (1 - orbit.e)) ** 2;
}

/**
 * Solve Kepler's equation `M = E − e·sin E` for the eccentric anomaly `E` by
 * Newton's method. `M` is reduced to `[0, 2π)` first so the iteration stays
 * accurate for large `t`; a handful of steps converge for the modest
 * eccentricities used here (most planets `e < 0.1`).
 */
function solveKepler(meanAnomaly: number, e: number): number {
  let m = meanAnomaly % TAU;
  if (m < 0)
    m += TAU;
  let eccentric = m;
  for (let i = 0; i < 8; i++) {
    const delta = (eccentric - e * Math.sin(eccentric) - m) / (1 - e * Math.cos(eccentric));
    eccentric -= delta;
    if (Math.abs(delta) < 1e-12)
      break;
  }
  return eccentric;
}

/**
 * Rotate a point given in the orbit's own (perifocal) plane into 3D world
 * coordinates and add the focus: `R_z(Ω)·R_x(i)·R_z(ω)` then translate. Shared by
 * the live-position and orbit-ring samplers. With `inclination = 0` and
 * `longitudeAscendingNode = 0` this collapses to the old flat `argPeriapsis`-only
 * rotation, so coplanar orbits are unchanged.
 */
function perifocalToWorld(orbit: OrbitElements, xOrbit: number, yOrbit: number, out: { x: number; y: number; z: number }): void {
  const { argPeriapsis, cx, cy, cz, inclination, longitudeAscendingNode } = orbit;
  const cosW = Math.cos(argPeriapsis);
  const sinW = Math.sin(argPeriapsis);
  const x1 = xOrbit * cosW - yOrbit * sinW;
  const y1 = xOrbit * sinW + yOrbit * cosW;
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  const y2 = y1 * cosI;
  const z2 = y1 * sinI;
  const cosO = Math.cos(longitudeAscendingNode);
  const sinO = Math.sin(longitudeAscendingNode);
  out.x = cx + x1 * cosO - y2 * sinO;
  out.y = cy + x1 * sinO + y2 * cosO;
  out.z = cz + z2;
}

/**
 * Write the 3D orbital position at time `t` into `out` (no allocation). Uses the
 * eccentric-anomaly form `x' = a(cos E − e)`, `y' = a·sqrt(1−e²)·sin E` in the
 * orbital plane, then rotates it into the world by argument of periapsis,
 * inclination and ascending node (see `perifocalToWorld`). Exported so tests can
 * assert orbit invariants directly.
 */
export function writeOrbitPosition(orbit: OrbitElements, t: number, out: { x: number; y: number; z: number }): void {
  const n = TAU / orbitalPeriod(orbit.starMass, orbit.a);
  const eccentric = solveKepler(orbit.meanAnomaly0 + n * t, orbit.e);
  const xOrbit = orbit.a * (Math.cos(eccentric) - orbit.e);
  const yOrbit = orbit.a * Math.sqrt(1 - orbit.e * orbit.e) * Math.sin(eccentric);
  perifocalToWorld(orbit, xOrbit, yOrbit, out);
}

/**
 * Write the point on the orbit's ellipse at parameter angle `theta` (0..2π traces
 * the whole ellipse) into `out` in 3D world coordinates — the same
 * perifocal→world rotation as `writeOrbitPosition`, used to draw orbit rings in
 * both the 2D (x,y) and 3D (x,y,z) backends.
 */
export function writeOrbitEllipsePoint(orbit: OrbitElements, theta: number, out: { x: number; y: number; z: number }): void {
  const xOrbit = orbit.a * (Math.cos(theta) - orbit.e);
  const yOrbit = orbit.a * Math.sqrt(1 - orbit.e * orbit.e) * Math.sin(theta);
  perifocalToWorld(orbit, xOrbit, yOrbit, out);
}

/**
 * Inclination (i) and longitude of ascending node (Ω) for an orbit whose plane
 * has unit normal `(nx, ny, nz)`, both measured against the reference (z=0)
 * plane: `i = acos(n_z)` and the ascending node lies along `ẑ × n`. Inverse of
 * the rotation `writeOrbitPosition` applies, so a plane round-trips to the same
 * on-screen orbit. Used by generation to turn a system's disk / a planet's
 * equator (given as normals) into stored orbital elements.
 */
export function planeToElements(nx: number, ny: number, nz: number): { inclination: number; longitudeAscendingNode: number } {
  return {
    inclination: Math.acos(Math.min(1, Math.max(-1, nz))),
    longitudeAscendingNode: Math.atan2(nx, -ny),
  };
}

/**
 * Tilt the unit normal `(nx, ny, nz)` by `angle` radians toward the in-plane
 * direction `azimuth`, returning the new unit normal. Used to derive a planet's
 * orbital plane from its system disk (tilt by the mutual inclination) and its
 * equatorial / moon plane from that orbit (tilt by the axial obliquity).
 */
export function tiltNormal(nx: number, ny: number, nz: number, angle: number, azimuth: number): [number, number, number] {
  // Seed an in-plane basis from a reference axis that isn't parallel to n:
  // u = ref × n, with ref = ẑ unless n is nearly vertical (then ref = x̂).
  let ux: number;
  let uy: number;
  let uz: number;
  if (Math.abs(nz) < 0.999) {
    ux = -ny;
    uy = nx;
    uz = 0;
  }
  else {
    ux = 0;
    uy = -nz;
    uz = ny;
  }
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  // w = n × u (unit, since n and u are orthonormal)
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cosZ = Math.cos(azimuth);
  const sinZ = Math.sin(azimuth);
  const dirX = cosZ * ux + sinZ * wx;
  const dirY = cosZ * uy + sinZ * wy;
  const dirZ = cosZ * uz + sinZ * wz;
  return [cosA * nx + sinA * dirX, cosA * ny + sinA * dirY, cosA * nz + sinA * dirZ];
}

/**
 * Advance every orbiting entity to simulation time `simSeconds`. Periods are in
 * years (Kepler solar units), so the clock is converted from seconds to years
 * before sampling each orbit.
 *
 * Positions are mutated **in place** (via `get`, like the engine's own
 * `world.move`) rather than via `set` on purpose: a per-frame `set` fires the
 * store's lifecycle hook, whose `ComponentAdded` events accumulate in
 * `world.lifecycle` until flushed — an unbounded leak in a render loop that has
 * no subscribers and never runs `endOfTick`. In-place writes emit nothing and
 * allocate nothing on the hot path. Planets are not spatially indexed, so no
 * index needs syncing.
 */
export function updateOrbits(world: EcsWorld, simSeconds: number): void {
  const years = simSeconds / SECONDS_PER_YEAR;
  const positions = world.getStore(Position3DDef);
  const out = { x: 0, y: 0, z: 0 };
  // Pass 1: bodies orbiting a fixed focus (planets around their star, parent < 0).
  for (const [id, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent >= 0)
      continue;
    const pos = positions.get(id);
    if (!pos)
      continue;
    writeOrbitPosition(orbit, years, out);
    pos.x = out.x;
    pos.y = out.y;
    pos.z = out.z;
  }
  // Pass 2: bodies orbiting a moving parent (moons around a planet). The parent
  // was positioned in pass 1, so its current 3D position is the moon's focus.
  for (const [id, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent < 0)
      continue;
    const pos = positions.get(id);
    const parentPos = positions.get(orbit.parent);
    if (!pos || !parentPos)
      continue;
    orbit.cx = parentPos.x;
    orbit.cy = parentPos.y;
    orbit.cz = parentPos.z;
    writeOrbitPosition(orbit, years, out);
    pos.x = out.x;
    pos.y = out.y;
    pos.z = out.z;
  }
}

// Orbit-ring tessellation: the segment count adapts to the ring's on-screen size
// so the polyline hugs the true curve at any zoom. A fixed count looks chunky
// when a large orbit is zoomed right in — each straight chord spans many pixels,
// so the drawn line visibly departs from the smooth orbit (and from the planet,
// which rides the true curve). Bounded so tiny orbits stay cheap and huge ones
// stay finite.
const RING_MIN_SEGMENTS = 64;
// Capped low: only ~viewport/chord segments of any ring are ever on screen, so a
// ring far larger than the viewport (zoomed right in) shows a near-straight arc
// that needs few segments — a high cap just burns CPU rebuilding off-screen
// vertices every frame. 1024 stays smooth for any ring up to viewport-scale.
const RING_MAX_SEGMENTS = 1024;
const RING_CHORD_PX = 6;

/** Segment count to tessellate an orbit ring whose on-screen radius is `radiusPx`. */
export function ringSegmentCount(radiusPx: number): number {
  const target = Math.ceil((TAU * radiusPx) / RING_CHORD_PX);
  return Math.min(RING_MAX_SEGMENTS, Math.max(RING_MIN_SEGMENTS, target));
}

/** The stretch of an orbit ring to tessellate: `span` radians of the ellipse parameter from `start`, in `segments` chords. */
export interface RingArc {
  segments: number;
  span: number;
  start: number;
}

const RING_ARC_COARSE_SAMPLES = 256;
const RING_ARC_REFINE_STEPS = 60;

/**
 * Which part of an orbit ring to draw at `zoom` (px/AU). A ring that fits the
 * segment budget is drawn whole. A larger one (zoomed right in) is drawn only
 * ±`reachAu` of arc around its point closest to the focus: whole-ring chords
 * would each span many pixels and cut visibly inside the curve, so the planet
 * riding the true orbit would sit off its line.
 */
export function ringArc(orbit: OrbitElements, focusX: number, focusY: number, focusZ: number, reachAu: number, zoom: number): RingArc {
  if (Math.ceil((TAU * orbit.a * zoom) / RING_CHORD_PX) <= RING_MAX_SEGMENTS)
    return { segments: ringSegmentCount(orbit.a * zoom), span: TAU, start: 0 };
  const semiMinor = orbit.a * Math.sqrt(1 - orbit.e * orbit.e);
  // Arc length per radian is at least the semi-minor axis, so this half-width
  // covers at least `reach` of curve on each side of the closest point.
  const halfSpan = reachAu / semiMinor;
  if (halfSpan >= Math.PI)
    return { segments: RING_MAX_SEGMENTS, span: TAU, start: 0 };

  const point = { x: 0, y: 0, z: 0 };
  const distSq = (theta: number): number => {
    writeOrbitEllipsePoint(orbit, theta, point);
    return (point.x - focusX) ** 2 + (point.y - focusY) ** 2 + (point.z - focusZ) ** 2;
  };
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < RING_ARC_COARSE_SAMPLES; k++) {
    const theta = (k / RING_ARC_COARSE_SAMPLES) * TAU;
    const d = distSq(theta);
    if (d < bestD) {
      best = theta;
      bestD = d;
    }
  }
  // Pattern search: step toward whichever neighbour is closer, halving the step
  // when neither is, until it is far below the arc's own resolution.
  let step = TAU / RING_ARC_COARSE_SAMPLES;
  for (let k = 0; k < RING_ARC_REFINE_STEPS; k++) {
    const lo = distSq(best - step);
    const hi = distSq(best + step);
    if (lo < bestD && lo <= hi) {
      best -= step;
      bestD = lo;
    }
    else if (hi < bestD) {
      best += step;
      bestD = hi;
    }
    else {
      step /= 2;
    }
  }
  // Arc length per radian is at most `a`, so this bounds the on-screen length.
  const segments = Math.min(RING_MAX_SEGMENTS, Math.max(1, Math.ceil((2 * halfSpan * orbit.a * zoom) / RING_CHORD_PX)));
  return { segments, span: 2 * halfSpan, start: best - halfSpan };
}
