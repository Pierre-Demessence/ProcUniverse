import type { EntityId } from '@pierre/ecs/entity-id';

import type { PlanetPhysical } from './generation/planets';
import type { StarPhysical } from './generation/stars';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera, worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it } from 'vitest';

import { BlackHoleDef } from './generation/galaxies';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { pickBodyAt, pickGalaxyAt } from './pick';

const STAR: StarPhysical = {
  colorHex: '#ffffff',
  lifetime: 1e10,
  luminosity: 1,
  mass: 1,
  radius: 1,
  spectralClass: 'G',
  temperature: 5772,
};

const PLANET: PlanetPhysical = {
  density: 5.5,
  equilibriumTemp: 280,
  inHabitableZone: true,
  insolation: 1,
  mass: 1,
  radius: 1,
  type: 'rocky',
  waterState: 'liquid',
};

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(BlackHoleDef);
  return world;
}

function addStar(world: EcsWorld, x: number, y: number, discRadius = 0.1): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(RenderableDef).set(id, { fill: '#fff', kind: 'circle', radius: discRadius });
  world.getStore(StarPhysicalDef).set(id, STAR);
  return id;
}

function addPlanet(world: EcsWorld, x: number, y: number, discRadius = 0.1): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(RenderableDef).set(id, { fill: '#88f', kind: 'circle', radius: discRadius });
  world.getStore(PlanetPhysicalDef).set(id, PLANET);
  return id;
}

// A camera centred on the origin at 10 px/AU: the PICK_PX (14) halo spans
// 1.4 world units, wide enough to forgive a near-miss click.
const cam = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 10 });

/** Click at the screen position of a world point. */
function pickAtWorld(world: EcsWorld, camera = cam, wx = 0, wy = 0): ReturnType<typeof pickBodyAt> {
  const { vx, vy } = worldToView(wx, wy, camera);
  return pickBodyAt(world, camera, vx, vy);
}

describe('pickBodyAt', () => {
  it('selects a star under the cursor', () => {
    const world = makeWorld();
    const star = addStar(world, 0, 0);
    expect(pickAtWorld(world)).toEqual({ id: star, kind: 'star' });
  });

  it('returns null when the nearest body is beyond the tolerance', () => {
    const world = makeWorld();
    addStar(world, 0, 0);
    expect(pickAtWorld(world, cam, 5, 5)).toBeNull();
  });

  it('returns the nearest of several candidates within tolerance', () => {
    const world = makeWorld();
    const near = addStar(world, 0, 0);
    addStar(world, 1, 0);
    expect(pickAtWorld(world, cam, 0.3, 0)).toEqual({ id: near, kind: 'star' });
  });

  it('lets a planet win when it is the closest body, regardless of kind', () => {
    const world = makeWorld();
    const planet = addPlanet(world, 0, 0);
    addStar(world, 0.5, 0);
    expect(pickAtWorld(world, cam, 0.1, 0)).toEqual({ id: planet, kind: 'planet' });
  });

  it('treats a large drawn disc as click-anywhere, even when the pixel halo is tiny', () => {
    const world = makeWorld();
    // At 100 px/AU the halo is only 0.14 AU, so the 3-AU disc is what matters.
    const close = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 100 });
    const giant = addStar(world, 0, 0, 3);
    expect(pickAtWorld(world, close, 2.5, 0)).toEqual({ id: giant, kind: 'star' });
    expect(pickAtWorld(world, close, 3.5, 0)).toBeNull();
  });
});

describe('pickGalaxyAt', () => {
  it('selects the home galaxy at the world origin', () => {
    const fieldCam = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 1e-5 });
    const { vx, vy } = worldToView(0, 0, fieldCam);
    const galaxy = pickGalaxyAt(1337, fieldCam, 0, 0, vx, vy);
    expect(galaxy?.centerX).toBe(0);
    expect(galaxy?.centerY).toBe(0);
  });
});
