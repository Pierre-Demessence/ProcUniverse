import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { SectorData } from './universe';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { OrbitElementsDef } from '../sim/orbits';
import { BlackHoleDef } from './galaxies';
import { MoonPhysicalDef } from './moons';
import { NameDef } from './naming';
import { PlanetPhysicalDef } from './planets';
import { StarPhysicalDef } from './stars';
import { EARTH_MASS_SOLAR } from './units';

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
  const moonPhysicals = world.getStore(MoonPhysicalDef);
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
    names.set(starId, { human: sys.name.human, scientific: sys.name.scientific });
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
        parent: -1,
        starMass: sys.star.mass,
      });
      planetPhysicals.set(id, planet.physical);
      names.set(id, { human: planet.name.human, scientific: planet.name.scientific });
      ids.push(id);

      // Moons orbit the planet (a moving focus): parent is the planet entity, and
      // the central mass is the planet's, in solar units, so the period is right.
      const planetX = cx + planet.a;
      const planetMassSolar = planet.physical.mass * EARTH_MASS_SOLAR;
      for (const moon of planet.moons) {
        const moonId = world.createEntity();
        positions.set(moonId, { x: planetX + moon.a, y: cy });
        renderables.set(moonId, { fill: moon.color, kind: 'circle', radius: moon.radius });
        orbits.set(moonId, {
          a: moon.a,
          argPeriapsis: moon.argPeriapsis,
          cx: planetX,
          cy,
          e: moon.e,
          meanAnomaly0: moon.meanAnomaly0,
          parent: id,
          starMass: planetMassSolar,
        });
        moonPhysicals.set(moonId, moon.physical);
        names.set(moonId, { human: moon.name.human, scientific: moon.name.scientific });
        ids.push(moonId);
      }
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
    names.set(id, { human: bh.name.human, scientific: bh.name.scientific });
    ids.push(id);
  }

  return ids;
}
