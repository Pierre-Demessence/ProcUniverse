import type { EcsWorld } from '@pierre/ecs';
import type { ComponentDef } from '@pierre/ecs/component-store';
import type { Camera } from '@pierre/ecs/modules/camera';

import { simpleComponent } from '@pierre/ecs/component-store';
import { worldToView } from '@pierre/ecs/modules/camera';
import { PositionDef } from '@pierre/ecs/modules/transform';

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
 */
export interface OrbitElements {
  a: number;
  argPeriapsis: number;
  cx: number;
  cy: number;
  e: number;
  meanAnomaly0: number;
  parent: number;
  starMass: number;
}

export const OrbitElementsDef: ComponentDef<OrbitElements> = simpleComponent<OrbitElements>('orbitElements', {
  a: 'number',
  argPeriapsis: 'number',
  cx: 'number',
  cy: 'number',
  e: 'number',
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
 * Write the orbital position at time `t` into `out` (no allocation). Uses the
 * eccentric-anomaly form `x' = a(cos E − e)`, `y' = a·sqrt(1−e²)·sin E` rotated
 * by `argPeriapsis`, which avoids a separate true-anomaly/atan2 step and is
 * numerically stable. Exported so tests can assert orbit invariants directly.
 */
export function writeOrbitPosition(orbit: OrbitElements, t: number, out: { x: number; y: number }): void {
  const { a, argPeriapsis, cx, cy, e } = orbit;
  const n = TAU / orbitalPeriod(orbit.starMass, a);
  const eccentric = solveKepler(orbit.meanAnomaly0 + n * t, e);
  const xOrbit = a * (Math.cos(eccentric) - e);
  const yOrbit = a * Math.sqrt(1 - e * e) * Math.sin(eccentric);
  const cosW = Math.cos(argPeriapsis);
  const sinW = Math.sin(argPeriapsis);
  out.x = cx + xOrbit * cosW - yOrbit * sinW;
  out.y = cy + xOrbit * sinW + yOrbit * cosW;
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
  const positions = world.getStore(PositionDef);
  // Pass 1: bodies orbiting a fixed focus (planets around their star, parent < 0).
  for (const [id, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent >= 0)
      continue;
    const pos = positions.get(id);
    if (pos)
      writeOrbitPosition(orbit, years, pos);
  }
  // Pass 2: bodies orbiting a moving parent (moons around a planet). The parent
  // was positioned in pass 1, so its current position is the moon's focus.
  for (const [id, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent < 0)
      continue;
    const pos = positions.get(id);
    const parentPos = positions.get(orbit.parent);
    if (!pos || !parentPos)
      continue;
    orbit.cx = parentPos.x;
    orbit.cy = parentPos.y;
    writeOrbitPosition(orbit, years, pos);
  }
}

const RING_STROKE = 'rgba(150, 180, 230, 0.14)';
const MIN_RING_PX = 3;

/**
 * Draw each orbit as its true ellipse (star at a focus), in screen space,
 * culling off-screen ones. The ellipse centre sits a distance `a·e` from the
 * star toward apoapsis; the semi-minor axis is `a·sqrt(1−e²)`, rotated by
 * `argPeriapsis`.
 */
export function drawOrbitRings(ctx2d: CanvasRenderingContext2D, cam: Camera, world: EcsWorld): void {
  ctx2d.save();
  ctx2d.lineWidth = 1;
  ctx2d.strokeStyle = RING_STROKE;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    const semiMajor = orbit.a * cam.zoom;
    if (semiMajor < MIN_RING_PX)
      continue;
    const focus = worldToView(orbit.cx, orbit.cy, cam);
    const reach = orbit.a * (1 + orbit.e) * cam.zoom;
    if (focus.vx + reach < 0 || focus.vx - reach > cam.viewportW || focus.vy + reach < 0 || focus.vy - reach > cam.viewportH)
      continue;
    const offset = orbit.a * orbit.e * cam.zoom;
    const centerX = focus.vx - offset * Math.cos(orbit.argPeriapsis);
    const centerY = focus.vy - offset * Math.sin(orbit.argPeriapsis);
    const semiMinor = semiMajor * Math.sqrt(1 - orbit.e * orbit.e);
    ctx2d.beginPath();
    ctx2d.ellipse(centerX, centerY, semiMajor, semiMinor, orbit.argPeriapsis, 0, TAU);
    ctx2d.stroke();
  }
  ctx2d.restore();
}
