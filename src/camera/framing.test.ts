import type { EntityId } from '@pierre/ecs/entity-id';

import type { GalaxyParams } from '../generation/galaxies';
import type { MoonPhysical } from '../generation/moons';
import type { PlanetPhysical } from '../generation/planets';
import type { StarPhysical } from '../generation/stars';
import type { OrbitElements } from '../sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { DISC_FRAME_FACTOR, FRAME_MARGIN, GALAXY_SPRITE_SCALE, MAX_ZOOM, MIN_ZOOM } from '../config/render';
import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { SECONDS_PER_YEAR } from '../generation/units';
import { planetVisualRadius, starVisualRadius } from '../scale';
import { OrbitElementsDef, writeOrbitPosition } from '../sim/orbits';
import { frameZoom } from './focus';
import { frameSelection, lockedBodyLocalPos, selectionFrame } from './framing';

const STAR: StarPhysical = {
  age: 4.6e9,
  colorHex: '#ffffff',
  lifetime: 1e10,
  luminosity: 1,
  mass: 1,
  metallicity: 0,
  radius: 1,
  spectralClass: 'G',
  temperature: 5772,
};

const PLANET: PlanetPhysical = {
  density: 5.5,
  equilibriumTemp: 280,
  hasRings: false,
  inHabitableZone: true,
  insolation: 1,
  mass: 1,
  moonRichness: 0.5,
  obliquity: 23,
  obliquityAzimuth: 0,
  radius: 1,
  rotationPeriod: 24,
  tidallyLocked: false,
  type: 'rocky',
  waterState: 'liquid',
};

const MOON: MoonPhysical = {
  density: 3.3,
  mass: 0.012,
  radius: 0.27,
  tidallyLocked: true,
};

const ORBIT: OrbitElements = {
  a: 1,
  argPeriapsis: 0,
  cx: 0,
  cy: 0,
  cz: 0,
  e: 0,
  inclination: 0,
  longitudeAscendingNode: 0,
  meanAnomaly0: 0,
  parent: -1,
  starMass: 1,
};

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(Position3DDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(NameDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(MoonPhysicalDef);
  world.registerComponent(BlackHoleDef);
  return world;
}

function addStar(world: EcsWorld, x: number, y: number): EntityId {
  const id = world.createEntity();
  world.getStore(Position3DDef).set(id, { x, y, z: 0 });
  world.getStore(StarPhysicalDef).set(id, STAR);
  return id;
}

function addPlanet(world: EcsWorld, orbit: Partial<OrbitElements>, x = 0, y = 0): EntityId {
  const id = world.createEntity();
  world.getStore(Position3DDef).set(id, { x, y, z: 0 });
  world.getStore(PlanetPhysicalDef).set(id, PLANET);
  world.getStore(OrbitElementsDef).set(id, { ...ORBIT, ...orbit });
  return id;
}

function addMoon(world: EcsWorld, parent: EntityId, orbit: Partial<OrbitElements> = {}): EntityId {
  const id = world.createEntity();
  world.getStore(Position3DDef).set(id, { x: 0, y: 0, z: 0 });
  world.getStore(MoonPhysicalDef).set(id, MOON);
  world.getStore(OrbitElementsDef).set(id, { ...ORBIT, a: 0.002, parent, ...orbit });
  return id;
}

describe('selectionFrame', () => {
  it('frames a star by its outermost planet apoapsis', () => {
    const world = makeWorld();
    const star = addStar(world, 5, 5);
    addPlanet(world, { a: 1, cx: 5, cy: 5, e: 0 });
    addPlanet(world, { a: 10, cx: 5, cy: 5, e: 0.5 });
    const frame = selectionFrame({ id: star, kind: 'star' }, world, 0, 0);
    expect(frame).toEqual({ extentAu: Math.max(15, starVisualRadius(STAR.radius) * DISC_FRAME_FACTOR), x: 5, y: 5 });
  });

  it('ignores planets of other stars', () => {
    const world = makeWorld();
    const star = addStar(world, 0, 0);
    addPlanet(world, { a: 100, cx: 50, cy: 50 });
    const frame = selectionFrame({ id: star, kind: 'star' }, world, 0, 0);
    expect(frame?.extentAu).toBe(starVisualRadius(STAR.radius) * DISC_FRAME_FACTOR);
  });

  it('frames a planet by its outermost moon apoapsis', () => {
    const world = makeWorld();
    const planet = addPlanet(world, {}, 3, 4);
    addMoon(world, planet, { a: 0.002 });
    addMoon(world, planet, { a: 0.01, e: 0.1 });
    const frame = selectionFrame({ id: planet, kind: 'planet' }, world, 0, 0);
    expect(frame?.x).toBe(3);
    expect(frame?.y).toBe(4);
    expect(frame?.extentAu).toBeCloseTo(Math.max(0.011, planetVisualRadius(PLANET.radius) * DISC_FRAME_FACTOR));
  });

  it('frames a satellite-less moon by its disc', () => {
    const world = makeWorld();
    const planet = addPlanet(world, {});
    const moon = addMoon(world, planet);
    const frame = selectionFrame({ id: moon, kind: 'moon' }, world, 0, 0);
    expect(frame?.extentAu).toBe(planetVisualRadius(MOON.radius) * DISC_FRAME_FACTOR);
  });

  it('frames a galaxy at its origin-local centre', () => {
    const world = makeWorld();
    const galaxy = { centerX: 1000, centerY: 2000, radius: 50 } as unknown as GalaxyParams;
    const frame = selectionFrame({ galaxy, kind: 'galaxy' }, world, 900, 1900);
    expect(frame).toEqual({ extentAu: 50 * GALAXY_SPRITE_SCALE, x: 100, y: 100 });
  });

  it('returns null for the universe and for streamed-out bodies', () => {
    const world = makeWorld();
    expect(selectionFrame({ kind: 'universe', seed: 1 }, world, 0, 0)).toBeNull();
    expect(selectionFrame({ id: 999 as EntityId, kind: 'planet' }, world, 0, 0)).toBeNull();
  });
});

describe('frameSelection', () => {
  it('centres the camera and zooms to fit the frame', () => {
    const world = makeWorld();
    const star = addStar(world, 5, 5);
    addPlanet(world, { a: 10, cx: 5, cy: 5 });
    const camera = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 1 });
    frameSelection({ id: star, kind: 'star' }, world, camera, 0, 0);
    const extent = Math.max(10, starVisualRadius(STAR.radius) * DISC_FRAME_FACTOR);
    expect(camera.x).toBe(5);
    expect(camera.y).toBe(5);
    expect(camera.zoom).toBe(frameZoom(extent, 800, 600, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM));
  });

  it('leaves the camera alone for the universe', () => {
    const world = makeWorld();
    const camera = makeCamera({ viewportH: 600, viewportW: 800, x: 7, y: 8, zoom: 3 });
    frameSelection({ kind: 'universe', seed: 1 }, world, camera, 0, 0);
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 7, y: 8, zoom: 3 });
  });
});

describe('lockedBodyLocalPos', () => {
  const simSeconds = 0.3 * SECONDS_PER_YEAR;

  it('matches the orbit solver for a planet', () => {
    const world = makeWorld();
    const planet = addPlanet(world, { a: 2, e: 0.2 });
    const expected = { x: 0, y: 0, z: 0 };
    writeOrbitPosition({ ...ORBIT, a: 2, e: 0.2 }, 0.3, expected);
    expect(lockedBodyLocalPos(world, planet, simSeconds)).toEqual(expected);
  });

  it('nests a moon orbit around its planet position', () => {
    const world = makeWorld();
    const planet = addPlanet(world, { a: 2 });
    const moon = addMoon(world, planet, { a: 0.01 });
    const planetPos = { x: 0, y: 0, z: 0 };
    writeOrbitPosition({ ...ORBIT, a: 2 }, 0.3, planetPos);
    const expected = { x: 0, y: 0, z: 0 };
    writeOrbitPosition({ ...ORBIT, a: 0.01, cx: planetPos.x, cy: planetPos.y, cz: planetPos.z, parent: planet }, 0.3, expected);
    expect(lockedBodyLocalPos(world, moon, simSeconds)).toEqual(expected);
  });

  it('returns null when the body or its parent orbit is gone', () => {
    const world = makeWorld();
    const planet = addPlanet(world, {});
    const moon = addMoon(world, planet);
    world.getStore(OrbitElementsDef).delete(planet);
    expect(lockedBodyLocalPos(world, moon, simSeconds)).toBeNull();
    expect(lockedBodyLocalPos(world, 999 as EntityId, simSeconds)).toBeNull();
  });
});
