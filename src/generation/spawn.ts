import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { SectorData } from './universe';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { OrbitElementsDef } from '../sim/orbits';
import { BlackHoleDef } from './galaxies';
import { NameDef } from './naming';
import { PlanetPhysicalDef } from './planets';
import { StarPhysicalDef } from './stars';

const STAR_STROKE = 'rgba(255, 255, 255, 0.65)';
// A true-black core rimmed by a bright accretion glow. The fill must NOT match
// the scene background (#05060d) or the disc is invisible against it.
const BLACK_HOLE_FILL = '#000000';
const BLACK_HOLE_RING = 'rgba(255, 170, 90, 0.95)';

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
  const orbits = world.getStore(OrbitElementsDef);
  const starPhysicals = world.getStore(StarPhysicalDef);
  const planetPhysicals = world.getStore(PlanetPhysicalDef);
  const blackHoles = world.getStore(BlackHoleDef);
  const names = world.getStore(NameDef);
  const ids: EntityId[] = [];

  for (const sys of data.systems) {
    const cx = sys.x - originX;
    const cy = sys.y - originY;
    const starId = world.createEntity();
    positions.set(starId, { x: cx, y: cy });
    renderables.set(starId, {
      fill: sys.star.colorHex,
      kind: 'circle',
      lineWidth: sys.radius * 0.08,
      radius: sys.radius,
      stroke: STAR_STROKE,
    });
    starPhysicals.set(starId, sys.star);
    names.set(starId, { name: sys.name });
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
        argPeriapsis: planet.argPeriapsis,
        cx,
        cy,
        e: planet.e,
        meanAnomaly0: planet.meanAnomaly0,
        starMass: sys.star.mass,
      });
      planetPhysicals.set(id, planet.physical);
      names.set(id, { name: planet.name });
      ids.push(id);
    }
  }

  // A galaxy's central black hole: a dark disc ringed by an accretion glow,
  // positioned at the galaxy centre in the floating render frame.
  for (const bh of data.blackHoles) {
    const id = world.createEntity();
    positions.set(id, { x: bh.x - originX, y: bh.y - originY });
    renderables.set(id, {
      fill: BLACK_HOLE_FILL,
      kind: 'circle',
      lineWidth: bh.radius * 0.4,
      radius: bh.radius,
      stroke: BLACK_HOLE_RING,
    });
    blackHoles.set(id, { eddingtonRatio: bh.eddingtonRatio, mass: bh.mass, schwarzschildRadius: bh.schwarzschildRadius, spin: bh.spin });
    names.set(id, { name: bh.name });
    ids.push(id);
  }

  return ids;
}
