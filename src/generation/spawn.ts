import type { EcsWorld } from '@pierre/ecs';

import type { SectorData } from './universe';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { OrbitDef } from '../sim/orbits';

const STAR_STROKE = 'rgba(255, 255, 255, 0.65)';

export interface SpawnCounts {
  planets: number;
  stars: number;
}

/**
 * Spawn ECS entities for a generated sector: one star per system, plus one
 * orbiting planet entity per planet. Planet positions are overwritten by
 * `updateOrbits` before the first frame, so the seed position here is nominal.
 */
export function spawnSector(world: EcsWorld, data: SectorData): SpawnCounts {
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  const orbits = world.getStore(OrbitDef);
  let planets = 0;

  for (const sys of data.systems) {
    const starId = world.createEntity();
    positions.set(starId, { x: sys.x, y: sys.y });
    renderables.set(starId, {
      fill: sys.color,
      kind: 'circle',
      lineWidth: 2,
      radius: sys.radius,
      stroke: STAR_STROKE,
    });

    for (const planet of sys.planets) {
      const id = world.createEntity();
      positions.set(id, { x: sys.x + planet.a, y: sys.y });
      renderables.set(id, {
        fill: planet.color,
        kind: 'circle',
        radius: planet.radius,
      });
      orbits.set(id, {
        a: planet.a,
        cx: sys.x,
        cy: sys.y,
        omega: planet.omega,
        phase: planet.phase,
      });
      planets++;
    }
  }

  return { planets, stars: data.systems.length };
}
