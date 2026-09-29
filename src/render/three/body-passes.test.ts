import type { EntityId } from '@pierre/ecs/entity-id';

import type { MoonPhysical } from '../../generation/moons';
import type { PlanetPhysical } from '../../generation/planets';
import type { StarPhysical } from '../../generation/stars';
import type { OrbitElements } from '../../sim/orbits';
import type { BodyFrame, BodyPools, PooledMesh } from './body-passes';
import type { PlanetMaterialHandle } from './planet-material';
import type { RingMaterialHandle } from './planet-rings';
import type { StarMaterialHandle } from './star-material';

import { EcsWorld } from '@pierre/ecs';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import { BlackHoleDef } from '../../generation/galaxies';
import { MoonPhysicalDef } from '../../generation/moons';
import { PlanetPhysicalDef } from '../../generation/planets';
import { StarPhysicalDef } from '../../generation/stars';
import { OrbitElementsDef, PositionZDef } from '../../sim/orbits';
import { BodyPasses } from './body-passes';
import { RecyclePool } from './recycle-pool';

const STAR: StarPhysical = {
  age: 4.6e9,
  colorHex: '#ffffff',
  lifetime: 1e10,
  luminosity: 2,
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

const MOON: MoonPhysical = { density: 3.3, mass: 0.012, radius: 0.27, tidallyLocked: true };

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

const FRAME: BodyFrame = {
  cameraPosition: new Vector3(0, 0, 100),
  focusX: 0,
  focusY: 0,
  pxFactor: 500,
  simSeconds: 0,
  wallClock: 0,
};

function makePools(): BodyPools {
  const starHandle = () => ({ dispose: vi.fn(), setStar: vi.fn(), setTime: vi.fn() }) as unknown as StarMaterialHandle;
  const planetHandle = () => ({ dispose: vi.fn(), setFill: vi.fn() }) as unknown as PlanetMaterialHandle;
  const ringHandle = () => ({ dispose: vi.fn(), setRing: vi.fn() }) as unknown as RingMaterialHandle;
  return {
    generic: new RecyclePool(() => ({ handle: new MeshStandardMaterial(), mesh: new Mesh() })),
    planet: new RecyclePool(() => ({ handle: planetHandle(), mesh: new Mesh() })),
    ring: new RecyclePool(() => ({ handle: ringHandle(), mesh: new Mesh() })),
    star: new RecyclePool(() => ({ handle: starHandle(), mesh: new Mesh() })),
  };
}

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(PositionZDef);
  world.registerComponent(RenderableDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(MoonPhysicalDef);
  world.registerComponent(BlackHoleDef);
  return world;
}

function addBody(world: EcsWorld, x: number, y: number, radius = 0.5): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(RenderableDef).set(id, { fill: '#88f', kind: 'circle', radius });
  return id;
}

function addStar(world: EcsWorld, x: number, y: number): EntityId {
  const id = addBody(world, x, y);
  world.getStore(StarPhysicalDef).set(id, STAR);
  return id;
}

function addPlanet(world: EcsWorld, x: number, y: number, planet: PlanetPhysical = PLANET, orbit: OrbitElements | null = ORBIT): EntityId {
  const id = addBody(world, x, y);
  world.getStore(PlanetPhysicalDef).set(id, planet);
  if (orbit)
    world.getStore(OrbitElementsDef).set(id, orbit);
  return id;
}

function meshes(group: Group): Mesh[] {
  return group.children as Mesh[];
}

describe('bodyPasses', () => {
  it('creates a mesh the first frame a planet is selected and stamps picking data', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const id = addPlanet(world, 3, 4);
    passes.renderBodies(world, FRAME, null);
    expect(meshes(group)).toHaveLength(1);
    const mesh = meshes(group)[0]!;
    expect(mesh.position.toArray()).toEqual([3, 4, 0]);
    expect(mesh.userData).toMatchObject({ id, kind: 'planet' });
  });

  it('uses PositionZDef for the mesh z when present', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const id = addPlanet(world, 1, 2);
    world.getStore(PositionZDef).set(id, { z: 7 });
    passes.renderBodies(world, FRAME, null);
    expect(meshes(group)[0]!.position.z).toBe(7);
  });

  it('reuses the same entry when an entity streams out and back in', () => {
    const pools = makePools();
    const group = new Group();
    const passes = new BodyPasses(pools, group);
    const world = makeWorld();
    const id = addPlanet(world, 0, 0);
    passes.renderBodies(world, FRAME, null);
    const first = meshes(group)[0]!;
    world.destroyEntity(id);
    passes.renderBodies(world, FRAME, null);
    expect(meshes(group)).toHaveLength(0);
    addPlanet(world, 5, 5);
    passes.renderBodies(world, FRAME, null);
    expect(meshes(group)).toEqual([first]);
    let built = 0;
    pools.planet.forEach(() => built++);
    expect(built).toBe(1);
  });

  it('resets a recycled planet mesh (no stale scale.y or rotation from the previous body)', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const oblate = addPlanet(world, 0, 0, { ...PLANET, rotationPeriod: 3 });
    passes.renderBodies(world, FRAME, null);
    const mesh = meshes(group)[0]!;
    mesh.rotation.set(1, 2, 3);
    world.destroyEntity(oblate);
    passes.renderBodies(world, FRAME, null);
    addPlanet(world, 0, 0, PLANET, null);
    passes.renderBodies(world, FRAME, null);
    expect(mesh.scale.x).toBe(0.5);
    expect(mesh.scale.y).toBeCloseTo(0.5, 1);
    expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('skips entities without a renderable, position, or with a non-circle renderable', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const noRender = world.createEntity();
    world.getStore(PositionDef).set(noRender, { x: 0, y: 0 });
    world.getStore(PlanetPhysicalDef).set(noRender, PLANET);
    const noPosition = world.createEntity();
    world.getStore(RenderableDef).set(noPosition, { fill: '#fff', kind: 'circle', radius: 1 });
    world.getStore(PlanetPhysicalDef).set(noPosition, PLANET);
    const rect = world.createEntity();
    world.getStore(PositionDef).set(rect, { x: 0, y: 0 });
    world.getStore(RenderableDef).set(rect, { fill: '#fff', h: 1, kind: 'rect', w: 1 });
    world.getStore(PlanetPhysicalDef).set(rect, PLANET);
    expect(() => passes.renderBodies(world, FRAME, null)).not.toThrow();
    expect(meshes(group)).toHaveLength(0);
  });

  it('draws rings only for ringed planets that have orbit elements', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const ringed = { ...PLANET, hasRings: true };
    addPlanet(world, 0, 0, ringed);
    addPlanet(world, 1, 0, ringed, null);
    addPlanet(world, 2, 0, PLANET);
    passes.renderBodies(world, FRAME, null);
    const kinds = meshes(group).map(m => (m.userData as { kind?: string }).kind);
    expect(kinds.filter(k => k === 'planet')).toHaveLength(3);
    expect(kinds.filter(k => k === undefined)).toHaveLength(1);
  });

  it('draws moons and black holes from the generic pool with their kinds', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    const moon = addBody(world, 0, 0);
    world.getStore(MoonPhysicalDef).set(moon, MOON);
    const hole = addBody(world, 1, 0);
    world.getStore(BlackHoleDef).set(hole, { eddingtonRatio: 0, mass: 1, schwarzschildRadius: 1, spin: 0 });
    passes.renderBodies(world, FRAME, null);
    const byId = new Map(meshes(group).map(m => [(m.userData as { id: number }).id, (m.userData as { kind: string }).kind]));
    expect(byId.get(moon)).toBe('moon');
    expect(byId.get(hole)).toBe('black-hole');
  });

  it('reports the star nearest the focus and floors its on-screen size', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    addStar(world, 50, 0);
    const near = addStar(world, 1, 0);
    const nearest = passes.renderStars(world, FRAME);
    expect(nearest.found).toBe(true);
    expect(nearest.position.toArray()).toEqual([1, 0, 0]);
    expect(nearest.luminosity).toBe(2);
    const nearMesh = meshes(group).find(m => (m.userData as { id: number }).id === near)!;
    expect(nearMesh.scale.x).toBeGreaterThanOrEqual(0.5);
  });

  it('reports no nearest star when there are none', () => {
    const passes = new BodyPasses(makePools(), new Group());
    expect(passes.renderStars(makeWorld(), FRAME).found).toBe(false);
  });

  it('releaseAll detaches every mesh and the passes keep working afterwards', () => {
    const group = new Group();
    const passes = new BodyPasses(makePools(), group);
    const world = makeWorld();
    addPlanet(world, 0, 0);
    passes.renderBodies(world, FRAME, null);
    passes.releaseAll();
    expect(meshes(group)).toHaveLength(0);
    passes.renderBodies(world, FRAME, null);
    expect(meshes(group)).toHaveLength(1);
  });

  it('dispose releases meshes and disposes every pooled handle', () => {
    const pools = makePools();
    const group = new Group();
    const passes = new BodyPasses(pools, group);
    const world = makeWorld();
    addPlanet(world, 0, 0);
    addStar(world, 1, 1);
    passes.renderStars(world, FRAME);
    passes.renderBodies(world, FRAME, null);
    passes.dispose();
    expect(meshes(group)).toHaveLength(0);
    const handles: PooledMesh<{ dispose: () => void }>[] = [];
    pools.planet.forEach(e => handles.push(e as PooledMesh<{ dispose: () => void }>));
    pools.star.forEach(e => handles.push(e as PooledMesh<{ dispose: () => void }>));
    expect(handles).toHaveLength(2);
    for (const entry of handles)
      expect(entry.handle.dispose).toHaveBeenCalledTimes(1);
  });
});
