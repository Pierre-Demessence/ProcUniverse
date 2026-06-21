import type { EcsWorld } from '@pierre/ecs';
import type { ComponentDef } from '@pierre/ecs/component-store';
import type { Camera } from '@pierre/ecs/modules/camera';

import { simpleComponent } from '@pierre/ecs/component-store';
import { worldToView } from '@pierre/ecs/modules/camera';
import { PositionDef } from '@pierre/ecs/modules/transform';

/**
 * A closed-form circular orbit. The planet's position is a pure function of a
 * global clock `t`: no N-body integration, so an un-instantiated system's
 * planets are always exactly where the formula says.
 *
 * `cx`/`cy` is the star centre (systems are static within their cell for now),
 * `a` the orbital radius, `omega` the angular speed (rad/s, Keplerian
 * `~ a^-1.5`), and `phase` the angle at `t = 0`.
 */
export interface Orbit {
  a: number;
  cx: number;
  cy: number;
  omega: number;
  phase: number;
}

export const OrbitDef: ComponentDef<Orbit> = simpleComponent<Orbit>('orbit', {
  a: 'number',
  cx: 'number',
  cy: 'number',
  omega: 'number',
  phase: 'number',
});

/**
 * Write each orbiting entity's position for simulation time `t` (seconds).
 *
 * Positions are mutated **in place** (via `get`, like the engine's own
 * `world.move`) rather than via `set` on purpose: a per-frame `set` fires the
 * store's lifecycle hook, whose `ComponentAdded` events accumulate in
 * `world.lifecycle` until flushed — an unbounded leak in a render loop that has
 * no subscribers and never runs `endOfTick`. In-place writes emit nothing and
 * allocate nothing on the hot path. Planets are not spatially indexed, so no
 * index needs syncing.
 */
export function updateOrbits(world: EcsWorld, t: number): void {
  const positions = world.getStore(PositionDef);
  for (const [id, orbit] of world.query(OrbitDef)) {
    const pos = positions.get(id);
    if (!pos)
      continue;
    const angle = orbit.phase + orbit.omega * t;
    pos.x = orbit.cx + orbit.a * Math.cos(angle);
    pos.y = orbit.cy + orbit.a * Math.sin(angle);
  }
}

const RING_STROKE = 'rgba(150, 180, 230, 0.14)';
const MIN_RING_PX = 3;

/** Draw a faint ring for each orbit, in screen space, culling off-screen ones. */
export function drawOrbitRings(ctx2d: CanvasRenderingContext2D, cam: Camera, world: EcsWorld): void {
  ctx2d.save();
  ctx2d.lineWidth = 1;
  ctx2d.strokeStyle = RING_STROKE;
  for (const [, orbit] of world.query(OrbitDef)) {
    const r = orbit.a * cam.zoom;
    if (r < MIN_RING_PX)
      continue;
    const c = worldToView(orbit.cx, orbit.cy, cam);
    if (c.vx + r < 0 || c.vx - r > cam.viewportW || c.vy + r < 0 || c.vy - r > cam.viewportH)
      continue;
    ctx2d.beginPath();
    ctx2d.arc(c.vx, c.vy, r, 0, Math.PI * 2);
    ctx2d.stroke();
  }
  ctx2d.restore();
}
