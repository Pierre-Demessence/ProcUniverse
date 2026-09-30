import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { SectorData } from './universe';

import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { OrbitElementsDef } from '../sim/orbits';
import { BodyVisualDef } from './body-visual';
import { BlackHoleDef } from './galaxies';
import { MoonPhysicalDef } from './moons';
import { NameDef } from './naming';
import { PlanetPhysicalDef } from './planets';
import { StarPhysicalDef } from './stars';
import { EARTH_MASS_SOLAR } from './units';

// Dark grey, not black, so the black-hole sphere reads as a shaded body against
// the black sky.
const BLACK_HOLE_COLOR = '#15151c';

/**
 * Spawn ECS entities for a generated sector: one star per system, plus one
 * orbiting planet entity per planet. Positions and orbit centres are stored
 * **relative to `(originX, originY, originZ)`** — the floating render origin — so the
 * renderer always works on small, precise coordinates however far the camera
 * has travelled. Returns every spawned entity id (each star immediately before
 * its planets) so the streamer can despawn the sector later.
 */
export function spawnSector(
  world: EcsWorld,
  data: SectorData,
  originX: number,
  originY: number,
  originZ: number,
): EntityId[] {
  const positions = world.getStore(Position3DDef);
  const visuals = world.getStore(BodyVisualDef);
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
    const cz = sys.z - originZ;
    const starId = world.createEntity();
    positions.set(starId, { x: cx, y: cy, z: cz });
    visuals.set(starId, { color: sys.star.colorHex, radius: sys.radius });
    starPhysicals.set(starId, sys.star);
    names.set(starId, { human: sys.name.human, scientific: sys.name.scientific });
    ids.push(starId);

    for (const planet of sys.planets) {
      const id = world.createEntity();
      positions.set(id, { x: cx + planet.a, y: cy, z: cz });
      visuals.set(id, { color: planet.color, radius: planet.radius });
      orbits.set(id, {
        a: planet.a,
        argPeriapsis: planet.argPeriapsis,
        cx,
        cy,
        cz,
        e: planet.e,
        inclination: planet.inclination,
        longitudeAscendingNode: planet.longitudeAscendingNode,
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
        positions.set(moonId, { x: planetX + moon.a, y: cy, z: cz });
        visuals.set(moonId, { color: moon.color, radius: moon.radius });
        orbits.set(moonId, {
          a: moon.a,
          argPeriapsis: moon.argPeriapsis,
          cx: planetX,
          cy,
          cz,
          e: moon.e,
          inclination: moon.inclination,
          longitudeAscendingNode: moon.longitudeAscendingNode,
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

  // A galaxy's central black hole, at the galaxy centre on the galactic plane
  // (z = 0), in the floating render frame.
  for (const bh of data.blackHoles) {
    const id = world.createEntity();
    positions.set(id, { x: bh.x - originX, y: bh.y - originY, z: -originZ });
    visuals.set(id, { color: BLACK_HOLE_COLOR, radius: bh.radius });
    blackHoles.set(id, { eddingtonRatio: bh.eddingtonRatio, mass: bh.mass, schwarzschildRadius: bh.schwarzschildRadius, spin: bh.spin });
    names.set(id, { human: bh.name.human, scientific: bh.name.scientific });
    ids.push(id);
  }

  return ids;
}
