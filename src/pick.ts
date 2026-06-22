import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import { viewToWorld } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { PICK_PX } from './config';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';

export type BodyKind = 'planet' | 'star';

export interface PickResult {
  id: EntityId;
  kind: BodyKind;
}

/**
 * Find the body nearest the cursor within the pick tolerance, or `null`. Both
 * `bx`/`by` (canvas backing pixels) and the entity positions are in the floating
 * render-origin frame that `localCam` describes, so the cursor unprojects
 * straight into the same coordinates the stars and planets live in.
 *
 * Tolerance is the larger of the body's drawn disc radius and `PICK_PX` (in
 * world units), so large discs are click-anywhere while tiny ones still get a
 * forgiving screen-pixel halo. Stars and planets compete on equal footing; the
 * closest centre wins.
 */
export function pickBodyAt(world: EcsWorld, localCam: Camera, bx: number, by: number): PickResult | null {
  const { wx, wy } = viewToWorld(bx, by, localCam);
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  const haloWorld = PICK_PX / localCam.zoom;

  let best: PickResult | null = null;
  let bestDist = Infinity;

  const consider = (id: EntityId, kind: BodyKind): void => {
    const pos = positions.get(id);
    if (!pos)
      return;
    const dist = Math.hypot(pos.x - wx, pos.y - wy);
    const renderable = renderables.get(id);
    const discRadius = renderable?.kind === 'circle' ? renderable.radius : 0;
    const tolerance = Math.max(discRadius, haloWorld);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = { id, kind };
    }
  };

  for (const [id] of world.query(StarPhysicalDef))
    consider(id, 'star');
  for (const [id] of world.query(PlanetPhysicalDef))
    consider(id, 'planet');

  return best;
}
