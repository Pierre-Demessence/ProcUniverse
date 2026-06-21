import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { SectorData } from './universe';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { OrbitDef } from '../sim/orbits';

const STAR_STROKE = 'rgba(255, 255, 255, 0.65)';

/**
 * Spawn ECS entities for a generated sector: one star per system, plus one
 * orbiting planet entity per planet. Positions and orbit centres are stored
 * **relative to `(originX, originY)`** — the floating render origin — so the
 * renderer always works on small, precise coordinates however far the camera
 * has travelled. Returns every spawned entity id (each star immediately before
 * its planets) so the streamer can despawn the sector later.
 */
export function spawnSector(
  world: EcsWorld,
  data: SectorData,
  originX: number,
  originY: number,
): EntityId[] {
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  const orbits = world.getStore(OrbitDef);
  const ids: EntityId[] = [];

  for (const sys of data.systems) {
    const cx = sys.x - originX;
    const cy = sys.y - originY;
    const starId = world.createEntity();
    positions.set(starId, { x: cx, y: cy });
    renderables.set(starId, {
      fill: sys.color,
      kind: 'circle',
      lineWidth: 2,
      radius: sys.radius,
      stroke: STAR_STROKE,
    });
    ids.push(starId);

    for (const planet of sys.planets) {
      const id = world.createEntity();
      positions.set(id, { x: cx + planet.a, y: cy });
      renderables.set(id, {
        fill: planet.color,
        kind: 'circle',
        radius: planet.radius,
      });
      orbits.set(id, {
        a: planet.a,
        cx,
        cy,
        omega: planet.omega,
        phase: planet.phase,
      });
      ids.push(id);
    }
  }

  return ids;
}
