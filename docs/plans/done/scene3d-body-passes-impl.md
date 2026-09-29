# Scene3D body passes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the index-based mesh pools in `ThreeRenderer.render()` with engine `Scene3DRenderer` passes that recycle meshes through free-lists.

**Architecture:** A pure `RecyclePool<T>` hands out and takes back pooled mesh entries. `BodyPasses` (new `body-passes.ts`) builds five `Scene3DRenderer` passes (stars, planets, moons, black holes, rings) whose `create` takes from a pool and whose `remove` gives back. `ThreeRenderer.render()` keeps camera setup, the star light and the final draw, and calls the passes in a pinned order.

**Tech Stack:** TypeScript, three.js (`three/webgpu`), `@pierre/ecs` (`modules/render-scene3d`, with the optional `remove` callback), vitest.

**Spec:** [scene3d-body-passes.md](scene3d-body-passes.md). Both files move to `docs/plans/done/` with the final commit.

## Global Constraints

- No visual change: fills, scale, orientation, star light, star minimum screen size, ring shadow and bloom match the current output.
- Picking still reads `userData.id` / `userData.kind` on meshes that are children of `group` (`ThreeRenderer.pickAt`).
- Bodies keep `PositionDef` + `PositionZDef` (`z ?? 0`); `Position3DDef` is out of scope.
- Do not run the app in a browser (AGENTS.md); run `npm run lint:fix && npm run build && npm test` and hand browser checks to Pierre.
- No commits unless Pierre asks; the plan step "Checkpoint" only runs the checks.
- Comments explain why, not what; TypeScript strict, no `any`.

## Review Focus

Failure modes the spec implies but the happy-path tests do not cover; each is pinned by a test named in the owning task.

1. A recycled planet mesh keeps a stale `scale.y` or rotation from its previous body (Task 2, "resets a recycled planet mesh").
2. An entity that streams out and back in creates a second material instead of reusing one (Task 2, "reuses the same entry").
3. A body missing its renderable, position, or with a non-circle renderable throws or draws (Task 2, "skips entities").
4. A ringed planet without orbit elements, or a non-ringed planet, gets a ring mesh (Task 2, "ring pass").
5. `releaseAll()` then a new frame fails or double-registers meshes (Task 2, "releaseAll").

## File Structure

- Create `src/render/three/recycle-pool.ts`: `RecyclePool<T>`, no three.js dependency.
- Create `src/render/three/recycle-pool.test.ts`.
- Create `src/render/three/body-passes.ts`: pool types, entity selectors, per-kind sync, `BodyPasses`, and the planet-orientation helpers moved out of `ThreeRenderer`.
- Create `src/render/three/body-passes.test.ts`.
- Modify `src/render/three/three-renderer.ts`: build pools, hold a `BodyPasses`, shrink `render()`, update `dispose()`.

---

### Task 1: RecyclePool

**Files:**
- Create: `src/render/three/recycle-pool.ts`
- Test: `src/render/three/recycle-pool.test.ts`

**Interfaces:**
- Produces: `class RecyclePool<T>` with `constructor(build: () => T)`, `take(): T`, `give(entry: T): void`, `forEach(visit: (entry: T) => void): void` (visits every entry ever built, in use or free).

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { RecyclePool } from './recycle-pool';

describe('recyclePool', () => {
  it('builds an entry when none is free', () => {
    const build = vi.fn(() => ({}));
    const pool = new RecyclePool(build);
    pool.take();
    pool.take();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('hands a given entry back out instead of building', () => {
    const build = vi.fn(() => ({}));
    const pool = new RecyclePool(build);
    const first = pool.take();
    pool.give(first);
    expect(pool.take()).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('visits every entry ever built, in use or free', () => {
    const pool = new RecyclePool(() => ({}));
    const a = pool.take();
    const b = pool.take();
    pool.give(a);
    const seen: object[] = [];
    pool.forEach(entry => seen.push(entry));
    expect(seen).toEqual([a, b]);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/render/three/recycle-pool.test.ts`
Expected: FAIL (cannot resolve `./recycle-pool`).

- [x] **Step 3: Write the implementation**

```ts
/**
 * Hands out recycled entries of a resource that is costly to build (a mesh with
 * its own GPU material) and takes them back, so entities streaming in and out
 * neither leak materials nor rebuild shaders.
 */
export class RecyclePool<T> {
  private readonly build: () => T;
  private readonly built: T[] = [];
  private readonly free: T[] = [];

  constructor(build: () => T) {
    this.build = build;
  }

  /** Visits every entry ever built, in use or free — for final disposal. */
  forEach(visit: (entry: T) => void): void {
    this.built.forEach(visit);
  }

  give(entry: T): void {
    this.free.push(entry);
  }

  take(): T {
    const reused = this.free.pop();
    if (reused !== undefined)
      return reused;
    const entry = this.build();
    this.built.push(entry);
    return entry;
  }
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/render/three/recycle-pool.test.ts`
Expected: PASS (3 tests).

---

### Task 2: BodyPasses

**Files:**
- Create: `src/render/three/body-passes.ts`
- Test: `src/render/three/body-passes.test.ts`

**Interfaces:**
- Consumes: `RecyclePool<T>` from Task 1; `Scene3DRenderer`, `Scene3DEntry`, `SceneGraph` from `@pierre/ecs/modules/render-scene3d`.
- Produces (all exported from `body-passes.ts`):
  - `interface PooledMesh<THandle> { handle: THandle; mesh: Mesh }`
  - `interface BodyPools { generic: RecyclePool<PooledMesh<MeshStandardMaterial>>; planet: RecyclePool<PooledMesh<PlanetMaterialHandle>>; ring: RecyclePool<PooledMesh<RingMaterialHandle>>; star: RecyclePool<PooledMesh<StarMaterialHandle>> }`
  - `interface BodyFrame { cameraPosition: Vector3; focusX: number; focusY: number; pxFactor: number; simSeconds: number; wallClock: number }`
  - `interface NearestStar { distSq: number; fill: string; found: boolean; luminosity: number; position: Vector3 }`
  - `class BodyPasses` with `constructor(pools: BodyPools, group: Group)`, `renderStars(world: EcsWorld, frame: BodyFrame): NearestStar`, `renderBodies(world: EcsWorld, frame: BodyFrame, light: PointLight | null): void`, `releaseAll(): void` (detach every held mesh back to its pool), `dispose(): void` (`releaseAll` then dispose every pooled handle).

- [x] **Step 1: Write the failing tests**

```ts
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
  for (const def of [PositionDef, PositionZDef, RenderableDef, OrbitElementsDef, StarPhysicalDef, PlanetPhysicalDef, MoonPhysicalDef, BlackHoleDef])
    world.registerComponent(def);
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
    world.getStore(RenderableDef).set(rect, { fill: '#fff', height: 1, kind: 'rect', width: 1 });
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
```

- [x] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/render/three/body-passes.test.ts`
Expected: FAIL (cannot resolve `./body-passes`).

- [x] **Step 3: Write the implementation**

`src/render/three/body-passes.ts` (imports first; `npm run lint:fix` fixes member and import ordering):

```ts
/**
 * System-tier body management: one engine `Scene3DRenderer` pass per kind of
 * mesh. The passes own which meshes exist (created on first selection, removed
 * when the entity streams out); the free-lists below recycle the meshes and
 * their GPU materials, which the engine deliberately leaves to the caller.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { ComponentDef } from '@pierre/ecs/component-store';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Scene3DEntry, SceneGraph } from '@pierre/ecs/modules/render-scene3d';
import type { Group, Mesh, MeshStandardMaterial, PointLight } from 'three/webgpu';

import type { BlackHolePhysical } from '../../generation/galaxies';
import type { MoonPhysical } from '../../generation/moons';
import type { PlanetPhysical } from '../../generation/planets';
import type { StarPhysical } from '../../generation/stars';
import type { BodyKind } from '../../pick';
import type { OrbitElements } from '../../sim/orbits';
import type { PlanetMaterialHandle } from './planet-material';
import type { RingMaterialHandle } from './planet-rings';
import type { RecyclePool } from './recycle-pool';
import type { StarMaterialHandle } from './star-material';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { Scene3DRenderer } from '@pierre/ecs/modules/render-scene3d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { Quaternion, Vector3 } from 'three/webgpu';

import { STAR_MIN_SCREEN_PX, STAR_SPIN_RATE } from '../../config/render';
import { BlackHoleDef } from '../../generation/galaxies';
import { MoonPhysicalDef } from '../../generation/moons';
import { oblateness, PlanetPhysicalDef } from '../../generation/planets';
import { StarPhysicalDef } from '../../generation/stars';
import { OrbitElementsDef, PositionZDef, tiltNormal } from '../../sim/orbits';
import { oblatePolarScale } from '../body-scale';
import { ringOuterRadius, ringVariety } from './planet-rings';

const DEFAULT_FILL = '#ffffff';
const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;
/** A UV sphere's north pole is its local +Y axis; planet spheres are re-oriented so this points along the spin axis. */
const SPHERE_POLE = new Vector3(0, 1, 0);
/** A ring lies in its local XY plane (normal +Z); it is re-oriented so +Z points along the planet's spin axis. */
const RING_POLE = new Vector3(0, 0, 1);
/** Dark grey for the black-hole sphere so it reads as a shaded body, not black-on-black. */
const BLACK_HOLE_COLOR = '#15151c';

const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();
const tmpQuat2 = new Quaternion();

/** A pooled mesh together with whatever owns its material (a handle, or the material itself). */
export interface PooledMesh<THandle> {
  handle: THandle;
  mesh: Mesh;
}

export interface BodyPools {
  generic: RecyclePool<PooledMesh<MeshStandardMaterial>>;
  planet: RecyclePool<PooledMesh<PlanetMaterialHandle>>;
  ring: RecyclePool<PooledMesh<RingMaterialHandle>>;
  star: RecyclePool<PooledMesh<StarMaterialHandle>>;
}

/** Per-frame inputs the passes read; set by the caller before each pass runs. */
export interface BodyFrame {
  cameraPosition: Vector3;
  focusX: number;
  focusY: number;
  /** Screen pixels per world unit at unit distance; 0 before the first resize. */
  pxFactor: number;
  simSeconds: number;
  wallClock: number;
}

/** The star nearest the camera focus, filled in by the star pass; it carries the scene light. */
export interface NearestStar {
  distSq: number;
  fill: string;
  found: boolean;
  luminosity: number;
  position: Vector3;
}

interface BodyPose {
  fill: string;
  radius: number;
  x: number;
  y: number;
  z: number;
}

type Posed<TPhysical> = Scene3DEntry<[BodyPose, TPhysical]>;
type Entry<THandle> = PooledMesh<THandle>;
```

Continue the file with:

```ts
/** Yields every entity with `physicalDef` that also has a circle renderable and a position. */
function* selectPosed<TPhysical>(world: EcsWorld, physicalDef: ComponentDef<TPhysical>): Generator<Posed<TPhysical>> {
  const renderables = world.getStore(RenderableDef);
  const positions = world.getStore(PositionDef);
  const positionsZ = world.getStore(PositionZDef);
  for (const [id, physical] of world.query(physicalDef)) {
    const renderable = renderables.get(id);
    const position = positions.get(id);
    if (!renderable || renderable.kind !== 'circle' || !position)
      continue;
    yield [id, {
      fill: renderable.fill ?? DEFAULT_FILL,
      radius: renderable.radius,
      x: position.x,
      y: position.y,
      z: positionsZ.get(id)?.z ?? 0,
    }, physical];
  }
}

function* selectRinged(world: EcsWorld): Generator<Scene3DEntry<[BodyPose, PlanetPhysical, OrbitElements]>> {
  const orbits = world.getStore(OrbitElementsDef);
  for (const [id, pose, planet] of selectPosed(world, PlanetPhysicalDef)) {
    const orbit = orbits.get(id);
    if (planet.hasRings && orbit)
      yield [id, pose, planet, orbit];
  }
}

/** The planet's spin axis: its orbit-plane normal tilted by obliquity around its azimuth. */
function planetSpinAxis(planet: PlanetPhysical, orbit: OrbitElements, out: Vector3): void {
  const sinI = Math.sin(orbit.inclination);
  const nx = sinI * Math.sin(orbit.longitudeAscendingNode);
  const ny = -sinI * Math.cos(orbit.longitudeAscendingNode);
  const nz = Math.cos(orbit.inclination);
  const [sx, sy, sz] = tiltNormal(nx, ny, nz, planet.obliquity * DEG2RAD, planet.obliquityAzimuth);
  out.set(sx, sy, sz);
}

/**
 * Orient a planet sphere so its pole points along its spin axis — the orbital
 * plane normal tilted by the axial obliquity around the stored azimuth — then
 * spin it about that axis. That is the same plane its (equatorial-orbit) moons
 * ride in, so a tilted planet and its moon disk visibly agree.
 */
function orientPlanet(mesh: Mesh, planet: PlanetPhysical, orbit: OrbitElements, simSeconds: number): void {
  planetSpinAxis(planet, orbit, tmpAxis);
  tmpQuat.setFromUnitVectors(SPHERE_POLE, tmpAxis);
  const spin = (simSeconds / (planet.rotationPeriod * 3600)) * TAU;
  tmpQuat2.setFromAxisAngle(tmpAxis, spin);
  mesh.quaternion.multiplyQuaternions(tmpQuat2, tmpQuat);
}

function stamp(mesh: Mesh, id: EntityId, kind: BodyKind): void {
  const data = mesh.userData as { id: number; kind: BodyKind };
  data.id = id;
  data.kind = kind;
}

/** Adds and removes the pooled entry's mesh in `group`; the engine calls it as bodies enter and leave. */
function meshGraph(group: Group): SceneGraph<PooledMesh<unknown>> {
  return {
    add: entry => group.add(entry.mesh),
    remove: entry => group.remove(entry.mesh),
  };
}

/** Objects come from `pool` and return to it when the entity leaves the pass. */
function makePass<THandle, TRow extends unknown[]>(
  pool: RecyclePool<Entry<THandle>>,
  select: (world: EcsWorld) => Iterable<Scene3DEntry<TRow>>,
  sync: (entry: Entry<THandle>, row: Scene3DEntry<TRow>, world: EcsWorld) => void,
): Scene3DRenderer<Entry<THandle>, TRow> {
  return new Scene3DRenderer<Entry<THandle>, TRow>({
    create: () => pool.take(),
    remove: entry => pool.give(entry),
    select,
    sync,
  });
}

const INITIAL_FRAME: BodyFrame = {
  cameraPosition: new Vector3(),
  focusX: 0,
  focusY: 0,
  pxFactor: 0,
  simSeconds: 0,
  wallClock: 0,
};

export class BodyPasses {
  private readonly blackHoles: Scene3DRenderer<Entry<MeshStandardMaterial>, [BodyPose, BlackHolePhysical]>;
  private frame = INITIAL_FRAME;
  private readonly graph: SceneGraph<PooledMesh<unknown>>;
  private light: PointLight | null = null;
  private readonly moons: Scene3DRenderer<Entry<MeshStandardMaterial>, [BodyPose, MoonPhysical]>;
  readonly nearestStar: NearestStar = { distSq: Infinity, fill: DEFAULT_FILL, found: false, luminosity: 0, position: new Vector3() };
  private readonly planets: Scene3DRenderer<Entry<PlanetMaterialHandle>, [BodyPose, PlanetPhysical]>;
  private readonly pools: BodyPools;
  private readonly rings: Scene3DRenderer<Entry<RingMaterialHandle>, [BodyPose, PlanetPhysical, OrbitElements]>;
  private readonly stars: Scene3DRenderer<Entry<StarMaterialHandle>, [BodyPose, StarPhysical]>;

  constructor(pools: BodyPools, group: Group) {
    this.pools = pools;
    this.graph = meshGraph(group);
    this.stars = makePass(pools.star, world => selectPosed(world, StarPhysicalDef), (entry, row) => this.syncStar(entry, row));
    this.planets = makePass(pools.planet, world => selectPosed(world, PlanetPhysicalDef), (entry, row, world) => this.syncPlanet(entry, row, world));
    this.rings = makePass(pools.ring, selectRinged, (entry, row) => this.syncRing(entry, row));
    this.moons = makePass(pools.generic, world => selectPosed(world, MoonPhysicalDef), (entry, row) => this.syncGeneric(entry, row, 'moon', null));
    this.blackHoles = makePass(pools.generic, world => selectPosed(world, BlackHoleDef), (entry, row) => this.syncGeneric(entry, row, 'black-hole', BLACK_HOLE_COLOR));
  }

  /** Stars pass. Returns the star nearest the focus so the caller can place the scene light before `renderBodies`. */
  renderStars(world: EcsWorld, frame: BodyFrame): NearestStar {
    this.frame = frame;
    const nearest = this.nearestStar;
    nearest.distSq = Infinity;
    nearest.found = false;
    this.stars.render({ graph: this.graph, world });
    return nearest;
  }

  /** Planets, rings, moons and black holes. `light` is the star light, or null when none is placed. */
  renderBodies(world: EcsWorld, frame: BodyFrame, light: PointLight | null): void {
    this.frame = frame;
    this.light = light;
    const context = { graph: this.graph, world };
    this.planets.render(context);
    this.rings.render(context);
    this.moons.render(context);
    this.blackHoles.render(context);
  }

  /** Detach every held mesh back to its pool. Call after a world reset: entity ids restart, so held meshes must not match new entities. */
  releaseAll(): void {
    this.stars.dispose(this.graph);
    this.planets.dispose(this.graph);
    this.rings.dispose(this.graph);
    this.moons.dispose(this.graph);
    this.blackHoles.dispose(this.graph);
  }

  /** Release every mesh, then free the GPU materials of everything ever built. */
  dispose(): void {
    this.releaseAll();
    this.pools.star.forEach(entry => entry.handle.dispose());
    this.pools.planet.forEach(entry => entry.handle.dispose());
    this.pools.ring.forEach(entry => entry.handle.dispose());
    this.pools.generic.forEach(entry => entry.handle.dispose());
  }

  private syncGeneric({ handle, mesh }: Entry<MeshStandardMaterial>, [id, pose]: Scene3DEntry<[BodyPose, unknown]>, kind: BodyKind, colorOverride: string | null): void {
    handle.color.set(colorOverride ?? pose.fill);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius);
    mesh.rotation.set(0, 0, 0);
    stamp(mesh, id, kind);
  }

  private syncPlanet({ handle, mesh }: Entry<PlanetMaterialHandle>, [id, pose, planet]: Scene3DEntry<[BodyPose, PlanetPhysical]>, world: EcsWorld): void {
    handle.setFill(pose.fill);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius);
    stamp(mesh, id, 'planet');
    // Squash the sphere at its equator by its rotational flattening: the drawn
    // radius is the equatorial radius, and the local +Y axis (which
    // `orientPlanet` aligns to the spin axis) is shortened to the polar radius.
    mesh.scale.y = mesh.scale.x * oblatePolarScale(oblateness(planet.rotationPeriod, planet.mass, planet.radius));
    const orbit = world.getStore(OrbitElementsDef).get(id);
    if (orbit)
      orientPlanet(mesh, planet, orbit, this.frame.simSeconds);
    else
      mesh.rotation.set(0, 0, 0);
  }

  /**
   * A translucent disc in the planet's equatorial plane, scaled to the planet's
   * drawn radius and oriented on its spin axis, lit by the star with the
   * planet's shadow band carved across it and coloured by temperature.
   */
  private syncRing({ handle, mesh }: Entry<RingMaterialHandle>, [, pose, planet, orbit]: Scene3DEntry<[BodyPose, PlanetPhysical, OrbitElements]>): void {
    const light = this.light;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(ringOuterRadius(pose.radius, ringVariety(planet.mass, planet.equilibriumTemp)));
    planetSpinAxis(planet, orbit, tmpAxis);
    mesh.quaternion.setFromUnitVectors(RING_POLE, tmpAxis);
    handle.setRing(mesh.position, pose.radius, light ? light.position : mesh.position, light && light.visible ? 1 : 0, planet.mass, planet.equilibriumTemp);
  }

  private syncStar({ handle, mesh }: Entry<StarMaterialHandle>, [id, pose, star]: Scene3DEntry<[BodyPose, StarPhysical]>): void {
    const frame = this.frame;
    mesh.position.set(pose.x, pose.y, pose.z);
    // Floor the on-screen size: a star's true disc shrinks below a pixel from
    // a distant planet and vanishes, but a real star stays a bright glare
    // point — so never draw it smaller than `STAR_MIN_SCREEN_PX` (bloom then
    // turns the floored dot into a visible glow). Guard the pre-resize case
    // where `pxFactor` is 0 (avoids an infinite radius).
    const distToCam = frame.cameraPosition.distanceTo(mesh.position);
    const minRadius = frame.pxFactor > 0 ? (STAR_MIN_SCREEN_PX * distToCam) / frame.pxFactor : 0;
    mesh.scale.setScalar(Math.max(pose.radius, minRadius));
    mesh.rotation.set(0, frame.simSeconds * STAR_SPIN_RATE, 0);
    handle.setStar(pose.fill, star.temperature);
    handle.setTime(frame.wallClock);
    stamp(mesh, id, 'star');
    const dx = pose.x - frame.focusX;
    const dy = pose.y - frame.focusY;
    const distSq = dx * dx + dy * dy;
    const nearest = this.nearestStar;
    if (distSq < nearest.distSq) {
      nearest.distSq = distSq;
      nearest.fill = pose.fill;
      nearest.found = true;
      nearest.luminosity = star.luminosity;
      nearest.position.copy(mesh.position);
    }
  }
}
```

- [x] **Step 4: Run tests and typecheck, fix until green**

Run: `npx vitest run src/render/three/body-passes.test.ts && npx tsc --noEmit`
Expected: PASS (11 tests), no type errors. If a test's `mesh.scale.y` assertion fails, compare with `oblatePolarScale` for the planet used and correct the expected value, not the behavior.

---

### Task 3: Wire ThreeRenderer

**Files:**
- Modify: `src/render/three/three-renderer.ts`

**Interfaces:**
- Consumes: `BodyPasses`, `BodyPools`, `BodyFrame`, `NearestStar`, `PooledMesh` from Task 2; `RecyclePool` from Task 1.

- [x] **Step 1: Build the pools and the passes**

In the constructor (after `planetRingGeometry`, `sphereGeometry` and `group` exist) add:

```ts
this.bodyPasses = new BodyPasses({
  generic: new RecyclePool(() => { const handle = new MeshStandardMaterial({ metalness: 0, roughness: 0.95 }); return { handle, mesh: new Mesh(this.sphereGeometry, handle) }; }),
  planet: new RecyclePool(() => { const handle = createPlanetMaterial(); return { handle, mesh: new Mesh(this.sphereGeometry, handle.material) }; }),
  ring: new RecyclePool(() => { const handle = createRingMaterial(); return { handle, mesh: new Mesh(this.planetRingGeometry, handle.material) }; }),
  star: new RecyclePool(() => { const handle = createStarMaterial(STAR_EMISSIVE_STRENGTH); return { handle, mesh: new Mesh(this.sphereGeometry, handle.material) }; }),
}, this.group);
```

Declare `private readonly bodyPasses: BodyPasses;` and add imports for `BodyPasses`, `RecyclePool`, and the type `BodyFrame`.

- [x] **Step 2: Replace the body loops in `render()`**

Delete from `const renderables = world.getStore(RenderableDef);` through the surplus-hiding loops, keeping `focusX/focusY`, `sceneRadius`, `syncPerspective`, the starfield-dome block and `pxFactor`. Then:

```ts
const frame: BodyFrame = {
  cameraPosition: this.perspective.position,
  focusX,
  focusY,
  pxFactor,
  simSeconds,
  wallClock: performance.now() / 1000,
};
const nearest = this.bodyPasses.renderStars(world, frame);
// One light at the focused system's star, tinted + scaled to it. Lights the
// planets/moons on their star-facing side without stacking (see `starLight`).
if (nearest.found) {
  const light = this.obtainStarLight();
  light.position.copy(nearest.position);
  light.color.set(nearest.fill);
  light.intensity = starLightIntensity(nearest.luminosity, LIGHT_STAR_BASE);
}
else if (this.starLight) {
  this.starLight.visible = false;
}
this.bodyPasses.renderBodies(world, frame, this.starLight);
this.updateOrbitRings(world, camera);
```

Keep the trailing pipeline / direct-draw block unchanged. Update the doc comment above `render` (drop "Bodies reuse pooled sphere meshes; the surplus is hidden.").

- [x] **Step 3: Delete the old code**

Remove `pool`, `planetSpherePool`, `starSpherePool`, `planetRingPool`, `obtainSphere`, `obtainPlanetSphere`, `obtainStarSphere`, `obtainPlanetRing`, `orientPlanet`, `planetSpinAxis`, and every now-unused constant, field and import (`DEFAULT_FILL`, `SPHERE_POLE`, `RING_POLE`, `BLACK_HOLE_COLOR`, `tmpAxis`, `tmpQuat*`, unused `three/webgpu` names, unused generation / sim imports). Let `tsc` and eslint report which ones remain unused; `updateOrbitRings` and `syncPerspective` may still use some tmp vectors, so remove only what is reported unused.

- [x] **Step 4: Update `dispose()`**

Replace the `for (const mesh of this.pool)`, `starSpherePool`, `planetSpherePool` and `planetRingPool` loops with `this.bodyPasses.dispose();` placed where the first of those loops was. Keep `sphereGeometry.dispose()` and `planetRingGeometry.dispose()`.

- [x] **Step 5: Static checks**

Run: `npm run lint:fix && npm run build && npm test`
Expected: lint clean, build succeeds, all tests pass (existing tests plus the 14 new ones).

---

### Task 4: Docs, review, hand-off

**Files:**
- Modify: `docs/research/engine-adoption.md`, `docs/roadmap.md`, `docs/codebase.md`, `docs/agent/README.md`, `docs/plans/scene3d-body-passes.md`

- [x] **Step 1: Update docs** (present tense, no dates or version stamps)
  - `engine-adoption.md`: add `Scene3DRenderer` (with the `remove` callback recycling meshes) to "Current usage"; delete its "Structural opportunities" subsection; keep `Position3DDef`.
  - `roadmap.md`: remove the `Scene3DRenderer` clause from the "Split `ThreeRenderer.render()`" item; keep the remaining split work (`three-renderer.ts` is still large).
  - `codebase.md` and `docs/agent/README.md`: list `body-passes.ts` and `recycle-pool.ts` under `src/render/three/`, with the invariant "pooled meshes are detached from `group` while unused; `pickAt` only sees live bodies".
- [x] **Step 2: Tick the spec checklist** in `docs/plans/scene3d-body-passes.md` and this plan's boxes; sweep both for deferred items (none expected; anything found gets a durable home in `roadmap.md`).
- [x] **Step 3: Peer review** with a fast-model subagent, one structured pass on correctness, types, ordering (stars → light → planets/rings → moons/black holes), and docs gaps. Prompt must include: "You are a subAgent. Do not use `vscode_askQuestions`. Do NOT edit code. Complete the task and return your result. No next steps." Fix findings.
- [x] **Step 4: Re-run** `npm run lint:fix && npm run build && npm test`.
- [x] **Step 5: Hand off to Pierre** the browser checks: star light and tint, star size at distance, moons and black holes, rings and their shadow, picking, streaming bodies in and out (pan across systems) with no hitches, toggling Canvas 2D / Three.js. Move both plan files to `docs/plans/done/` with the final commit when Pierre asks to commit.
