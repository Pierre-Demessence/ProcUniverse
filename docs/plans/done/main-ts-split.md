# Split main.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the state and logic that `src/main.ts` holds inside its single
~760-line `start()` closure into small, unit-tested modules, without changing
behaviour.

**Architecture:** Three kinds of extraction. (1) The pure helpers at the bottom
of `main.ts` (framing, bookmark creation, nav-tree state) move into modules next
to the code they belong with, and the duplicated "disc radius + satellite
extent" logic in `frameSelection` / `createBookmarkFromSelection` collapses into
one `selectionFrame`. (2) The selection / lock / pending-bookmark state that is
currently six `let` variables mutated from many handlers becomes one
`SelectionState` class. (3) The lazy Three.js loading and failure fallback
becomes a `ThreeBackend` class with an injected loader, so the fallback is
testable without a GPU. The frame loop itself stays in `main.ts` and calls these.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 4 (node environment),
`@pierre/ecs` (`EcsWorld`, component stores), ESLint `@antfu/eslint-config`
with perfectionist sorting.

**Spec:** this plan (no separate spec). Motivation: the project review found
`main.ts` untested and the source of most recent camera / reload bug fixes;
see [roadmap.md](../roadmap.md) "Engineering health".

## Global Constraints

- **Behaviour-preserving.** No user-visible change. Where a task simplifies
  logic, it states why the old and new behaviour are identical.
- **Lint sorting is enforced** (`perfectionist`): object-literal keys,
  interface members, imports, exports, and class members (properties →
  constructor → methods, each ascending, `id`/`name` first) must be sorted.
  Run `npm run lint:fix` after each task; it fixes ordering automatically.
- **Imports:** `import type` for type-only imports (`verbatimModuleSyntax`).
- **Tests:** `*.test.ts` beside the module, default node environment; build
  worlds with a real `EcsWorld` (pattern: `src/pick.test.ts` `makeWorld`).
- **No agent browser testing** (AGENTS.md). Each task ends with
  `npm run build`, `npm test`, `npm run lint` green.
- **Commits:** only when Pierre asks. Each task leaves the tree green so it can
  be committed on its own.
- **`ThreeBackend` must not import `three` or `three-renderer.ts`** — the Three
  chunk stays lazy-loaded.

## Review Focus

Wiring that stays in `main.ts` and has no unit test. These go to Pierre's
browser check at the end (Task 6):

1. Inspecting a bookmark whose system is not streamed yet: the camera jumps
   there, then centres on the body's **live** orbital position and selects it.
2. A locked planet stays centred while time runs fast; a left-drag releases the
   lock; a right-drag (orbit) does not.
3. Switching Renderer in Options Three → Canvas 2D → Three mid-session: no blank
   frames, clicks pick bodies in both.
4. Reload after moving and orbiting the camera resumes the same view (save on
   unload still reads the camera and orbit state).
5. A galaxy picked from the location tree stays selected while zooming through
   tiers; its reticle shows only at the galaxy-field tier.

---

## File map

| File | Change | Responsibility |
| ---- | ------ | -------------- |
| `src/camera/framing.ts` | Create | `selectionFrame`, `frameSelection`, `lockedBodyLocalPos`, satellite-apoapsis helpers. |
| `src/camera/framing.test.ts` | Create | Tests for the above. |
| `src/lod/nearest-system.ts` | Create | `nearestSystem` (was `nearestStar`). |
| `src/ui/nav-state.ts` | Create | `buildNavState`, `selectionKey`. |
| `src/ui/nav-state.test.ts` | Create | Tests for nav state and `nearestSystem`. |
| `src/bookmarks.ts` | Modify | Add `bookmarkFromSelection`, `toggleBookmark`, `removeBookmark`. |
| `src/bookmarks.test.ts` | Create | Tests for bookmark helpers. |
| `src/selection-state.ts` | Create | `SelectionState`: selection, lock, pending bookmark. |
| `src/selection-state.test.ts` | Create | Tests for `SelectionState`. |
| `src/render/three-backend.ts` | Create | `ThreeBackend`: lazy load, activation, failure fallback. |
| `src/render/three-backend.test.ts` | Create | Tests with a fake renderer and loader. |
| `src/main.ts` | Modify | Use the modules above; delete the moved code. |
| `docs/codebase.md`, `docs/roadmap.md` | Modify | Document new modules; update roadmap. |

Shared test fixtures used by several tasks (copy into each test file that needs
them — tasks may be read out of order):

```ts
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
```

`STAR`, `PLANET`, `MOON` physical fixtures: copy from `src/pick.test.ts`
lines 20–57.

---

### Task 1: Framing helpers (`src/camera/framing.ts`)

**Files:**
- Create: `src/camera/framing.ts`
- Create: `src/camera/framing.test.ts`
- Modify: `src/main.ts` (delete `starSatelliteApoapsis`, `planetSatelliteApoapsis`,
  `frameSelection`, `lockedBodyLocalPos` at the bottom; import them instead)

**Interfaces:**
- Produces:
  - `interface Frame { extentAu: number; x: number; y: number }` — centre in
    render-origin-local AU plus framing radius.
  - `selectionFrame(sel: Selection, world: EcsWorld, originX: number, originY: number): Frame | null`
  - `frameSelection(sel: Selection, world: EcsWorld, camera: Camera, originX: number, originY: number): void`
  - `lockedBodyLocalPos(world: EcsWorld, id: EntityId, simSeconds: number): { x: number; y: number; z: number } | null`

- [x] **Step 1: Write the failing tests** in `src/camera/framing.test.ts`:

```ts
import type { EntityId } from '@pierre/ecs/entity-id';

import type { GalaxyParams } from '../generation/galaxies';
import type { MoonPhysical } from '../generation/moons';
import type { PlanetPhysical } from '../generation/planets';
import type { StarPhysical } from '../generation/stars';
import type { OrbitElements } from '../sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { PositionDef } from '@pierre/ecs/modules/transform';
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

// STAR, PLANET, MOON: copy from src/pick.test.ts lines 20–57.
// ORBIT: copy from the plan's shared fixtures.

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(PositionDef);
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
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(StarPhysicalDef).set(id, STAR);
  return id;
}

function addPlanet(world: EcsWorld, orbit: Partial<OrbitElements>, x = 0, y = 0): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(PlanetPhysicalDef).set(id, PLANET);
  world.getStore(OrbitElementsDef).set(id, { ...ORBIT, ...orbit });
  return id;
}

function addMoon(world: EcsWorld, parent: EntityId, orbit: Partial<OrbitElements> = {}): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x: 0, y: 0 });
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
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/camera/framing.test.ts`
Expected: FAIL — cannot resolve `./framing`.

- [x] **Step 3: Implement `src/camera/framing.ts`**

The satellite and disc logic is moved verbatim from `main.ts`
(`starSatelliteApoapsis`, `planetSatelliteApoapsis`, `frameSelection`,
`lockedBodyLocalPos`); `selectionFrame` is the extent computation that
`frameSelection` and `createBookmarkFromSelection` both duplicated.

```ts
/**
 * Camera framing for a selection: where to centre and how much to show so a
 * body is framed together with whatever orbits it, plus the live position a
 * Lock follows. Coordinates are render-origin-local AU.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { Selection } from '../pick';

import { PositionDef } from '@pierre/ecs/modules/transform';

import { DISC_FRAME_FACTOR, FRAME_MARGIN, GALAXY_SPRITE_SCALE, MAX_ZOOM, MIN_ZOOM } from '../config/render';
import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { SECONDS_PER_YEAR } from '../generation/units';
import { blackHoleVisualRadius, planetVisualRadius, starVisualRadius } from '../scale';
import { OrbitElementsDef, writeOrbitPosition } from '../sim/orbits';
import { frameZoom } from './focus';

/** A framing target: render-origin-local centre (AU) and the radius to fit (AU). */
export interface Frame {
  extentAu: number;
  x: number;
  y: number;
}

/** The largest apoapsis among planets directly orbiting a star at the given position. */
function starSatelliteApoapsis(world: EcsWorld, starPosX: number, starPosY: number): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent < 0 && Math.hypot(orbit.cx - starPosX, orbit.cy - starPosY) < 1e-6)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/** The largest apoapsis among moons orbiting a given planet. */
function planetSatelliteApoapsis(world: EcsWorld, planetId: EntityId): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent === planetId)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/**
 * The frame for a selection: the larger of the outermost satellite apoapsis and
 * `DISC_FRAME_FACTOR × disc radius`, so a satellite-less body still gets a
 * comfortable framing. Null for the universe or a body that streamed out.
 */
export function selectionFrame(sel: Selection, world: EcsWorld, originX: number, originY: number): Frame | null {
  if (sel.kind === 'universe')
    return null;
  if (sel.kind === 'galaxy') {
    return {
      extentAu: sel.galaxy.radius * GALAXY_SPRITE_SCALE,
      x: sel.galaxy.centerX - originX,
      y: sel.galaxy.centerY - originY,
    };
  }

  const pos = world.getStore(PositionDef).get(sel.id);
  if (!pos)
    return null;

  let discRadiusAu: number;
  let satelliteExtent = 0;
  if (sel.kind === 'star') {
    const star = world.getStore(StarPhysicalDef).get(sel.id);
    if (!star)
      return null;
    discRadiusAu = starVisualRadius(star.radius);
    satelliteExtent = starSatelliteApoapsis(world, pos.x, pos.y);
  }
  else if (sel.kind === 'planet') {
    const planet = world.getStore(PlanetPhysicalDef).get(sel.id);
    if (!planet)
      return null;
    discRadiusAu = planetVisualRadius(planet.radius);
    satelliteExtent = planetSatelliteApoapsis(world, sel.id);
  }
  else if (sel.kind === 'moon') {
    const moon = world.getStore(MoonPhysicalDef).get(sel.id);
    if (!moon)
      return null;
    discRadiusAu = planetVisualRadius(moon.radius);
  }
  else {
    const bh = world.getStore(BlackHoleDef).get(sel.id);
    if (!bh)
      return null;
    discRadiusAu = blackHoleVisualRadius(bh.mass);
  }

  return { extentAu: Math.max(satelliteExtent, discRadiusAu * DISC_FRAME_FACTOR), x: pos.x, y: pos.y };
}

/** Pan and zoom the camera to the selection's frame; a no-op when there is none. */
export function frameSelection(sel: Selection, world: EcsWorld, camera: Camera, originX: number, originY: number): void {
  const frame = selectionFrame(sel, world, originX, originY);
  if (!frame)
    return;
  camera.zoom = frameZoom(frame.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
  camera.x = frame.x;
  camera.y = frame.y;
}

/**
 * Re-derive a body's position in the render-origin frame from the pure orbit
 * solver so Lock stays glued at any time scale (no one-frame lag) and without
 * round-tripping through absolute coordinates. Returns null when the entity or
 * its parent orbit has streamed out.
 */
export function lockedBodyLocalPos(world: EcsWorld, id: EntityId, simSeconds: number): { x: number; y: number; z: number } | null {
  const orbit = world.getStore(OrbitElementsDef).get(id);
  if (!orbit)
    return null;
  const years = simSeconds / SECONDS_PER_YEAR;
  const out = { x: 0, y: 0, z: 0 };
  if (orbit.parent < 0) {
    writeOrbitPosition(orbit, years, out);
  }
  else {
    const parentOrbit = world.getStore(OrbitElementsDef).get(orbit.parent);
    if (!parentOrbit)
      return null;
    const planetPos = { x: 0, y: 0, z: 0 };
    writeOrbitPosition(parentOrbit, years, planetPos);
    writeOrbitPosition({ ...orbit, cx: planetPos.x, cy: planetPos.y, cz: planetPos.z }, years, out);
  }
  return out;
}
```

Behaviour note: `frameSelection` previously returned early for the universe and
for missing stores; `selectionFrame` returns null in exactly those cases, so the
camera is untouched in the same situations.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/camera/framing.test.ts`
Expected: PASS (all tests).

- [x] **Step 5: Wire into `main.ts`**

Delete from `src/main.ts`: the `// ── Camera focus & lock helpers` divider,
`starSatelliteApoapsis`, `planetSatelliteApoapsis`, `frameSelection`, and
`lockedBodyLocalPos`. Add `import { frameSelection, lockedBodyLocalPos } from './camera/framing';`.
`createBookmarkFromSelection` still calls the two apoapsis helpers — in this
task make it call `selectionFrame` instead for its body branches (Task 3 moves
it out entirely):

```ts
  const frame = selectionFrame(sel, world, renderOriginX, renderOriginY);
  const identity = world.getStore(NameDef).get(sel.id);
  if (!frame || !identity)
    return null;
  return {
    name: identity.scientific,
    extentAu: frame.extentAu,
    kind: sel.kind,
    label: identity.human,
    x: cameraAbsolute(renderOriginX, frame.x),
    y: cameraAbsolute(renderOriginY, frame.y),
  };
```

(replacing everything from `const pos = world.getStore(PositionDef).get(sel.id);`
to the end of that function; keep its `universe` and `galaxy` branches as they
are). Remove imports that become unused (`lint` / `tsc` report them).

- [x] **Step 6: Verify**

Run: `npm run lint:fix && npm run build && npm test`
Expected: all green.

---

### Task 2: Nav-tree state (`src/ui/nav-state.ts`, `src/lod/nearest-system.ts`)

**Files:**
- Create: `src/lod/nearest-system.ts`
- Create: `src/ui/nav-state.ts`
- Create: `src/ui/nav-state.test.ts`
- Modify: `src/main.ts` (delete `nearestStar`, `buildNavState`, `selectionKey`)

**Interfaces:**
- Produces:
  - `nearestSystem(cache: Pick<SectorCache, 'get'>, camX: number, camY: number): SystemData | null`
    (absolute AU; renamed from `nearestStar` — it returns a system).
  - `selectionKey(world: EcsWorld, selection: Selection | null): string | null`
  - `buildNavState(seed: number, cache: Pick<SectorCache, 'get'>, camera: Camera, tier: Tier, world: EcsWorld, selection: Selection | null): NavState`
    (`camera` in absolute AU).

- [x] **Step 1: Write the failing tests** in `src/ui/nav-state.test.ts`:

```ts
import type { EntityId } from '@pierre/ecs/entity-id';

import type { GalaxyParams } from '../generation/galaxies';
import type { SectorData, SystemData } from '../generation/universe';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { NameDef } from '../generation/naming';
import { nearestSystem } from '../lod/nearest-system';
import { SECTOR_SIZE } from '../scale';
import { buildNavState, selectionKey } from './nav-state';

function system(x: number, y: number, name: string): SystemData {
  return {
    name: { human: `Human ${name}`, scientific: name },
    planets: [{ moons: [{ name: { human: 'Moon', scientific: `${name} b I` } }], name: { human: 'Planet', scientific: `${name} b` } }],
    x,
    y,
  } as unknown as SystemData;
}

function cacheOf(systems: SystemData[]): { get: (sx: number, sy: number) => SectorData } {
  return { get: () => ({ systems }) as unknown as SectorData };
}

function worldWithName(scientific: string): { id: EntityId; world: EcsWorld } {
  const world = new EcsWorld();
  world.registerComponent(NameDef);
  const id = world.createEntity();
  world.getStore(NameDef).set(id, { human: 'H', scientific });
  return { id, world };
}

describe('nearestSystem', () => {
  it('returns the closest system in the camera sector', () => {
    const near = system(10, 10, 'NEAR');
    const cache = cacheOf([system(900, 900, 'FAR'), near]);
    expect(nearestSystem(cache, 12, 11)).toBe(near);
  });

  it('returns null for an empty sector', () => {
    expect(nearestSystem(cacheOf([]), 0, 0)).toBeNull();
  });

  it('looks up the sector containing the camera', () => {
    const seen: [number, number][] = [];
    const cache = { get: (sx: number, sy: number): SectorData => {
      seen.push([sx, sy]);
      return { systems: [] } as unknown as SectorData;
    } };
    nearestSystem(cache, SECTOR_SIZE * 2.5, -SECTOR_SIZE * 0.5);
    expect(seen).toEqual([[2, -1]]);
  });
});

describe('selectionKey', () => {
  it('keys the universe, a galaxy, and a named body', () => {
    const { id, world } = worldWithName('G2-ABC');
    const galaxy = { name: 'NGC 1' } as unknown as GalaxyParams;
    expect(selectionKey(world, null)).toBeNull();
    expect(selectionKey(world, { kind: 'universe', seed: 1 })).toBe('universe');
    expect(selectionKey(world, { galaxy, kind: 'galaxy' })).toBe('galaxy:NGC 1');
    expect(selectionKey(world, { id, kind: 'star' })).toBe('G2-ABC');
  });

  it('is null for a body that streamed out', () => {
    const { world } = worldWithName('X');
    expect(selectionKey(world, { id: 999 as EntityId, kind: 'planet' })).toBeNull();
  });
});

describe('buildNavState', () => {
  const camera = makeCamera({ viewportH: 600, viewportW: 800, x: 10, y: 10, zoom: 1 });

  it('lists the focused system with planets and moons at the system tier', () => {
    const { world } = worldWithName('X');
    const nav = buildNavState(1, cacheOf([system(10, 10, 'SYS')]), camera, 'system', world, null);
    expect(nav.tier).toBe('system');
    expect(nav.system).toEqual({
      name: 'SYS',
      humanName: 'Human SYS',
      planets: [{ name: 'SYS b', humanName: 'Planet', moons: [{ name: 'SYS b I', humanName: 'Moon' }] }],
    });
  });

  it('omits the system above the system tier and carries the selection key', () => {
    const { id, world } = worldWithName('SYS');
    const nav = buildNavState(1, cacheOf([system(10, 10, 'SYS')]), camera, 'star', world, { id, kind: 'star' });
    expect(nav.system).toBeNull();
    expect(nav.selectedKey).toBe('SYS');
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/nav-state.test.ts`
Expected: FAIL — cannot resolve `../lod/nearest-system` / `./nav-state`.

- [x] **Step 3: Implement `src/lod/nearest-system.ts`** (moved from `main.ts`
`nearestStar`; the `cache` parameter narrows to `Pick<SectorCache, 'get'>` so
tests can pass a stub — `SectorCache` still satisfies it):

```ts
import type { SystemData } from '../generation/universe';
import type { SectorCache } from './sector-cache';

import { SECTOR_SIZE } from '../scale';

/** The system nearest an absolute position within its sector, or null if the sector is empty. */
export function nearestSystem(cache: Pick<SectorCache, 'get'>, camX: number, camY: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  let best: SystemData | null = null;
  let bestDist = Infinity;
  for (const sys of cache.get(sx, sy).systems) {
    const dx = sys.x - camX;
    const dy = sys.y - camY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = sys;
    }
  }
  return best;
}
```

- [x] **Step 4: Implement `src/ui/nav-state.ts`** (moved from `main.ts`
`buildNavState` and `selectionKey`, bodies unchanged apart from the rename):

```ts
/** Location-tree state derived from the camera, tier, and selection. */

import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { SectorCache } from '../lod/sector-cache';
import type { Tier } from '../lod/tier';
import type { Selection } from '../pick';
import type { NavState, NavSystem } from './nav-tree';

import { galaxyAt } from '../generation/galaxies';
import { NameDef } from '../generation/naming';
import { nearestSystem } from '../lod/nearest-system';

/** The tree-node `key` matching the current selection, for highlighting. */
export function selectionKey(world: EcsWorld, selection: Selection | null): string | null {
  if (!selection)
    return null;
  if (selection.kind === 'universe')
    return 'universe';
  if (selection.kind === 'galaxy')
    return `galaxy:${selection.galaxy.name}`;
  return world.getStore(NameDef).get(selection.id)?.scientific ?? null;
}

/** Assemble the location tree's state; `camera` is in absolute AU. */
export function buildNavState(seed: number, cache: Pick<SectorCache, 'get'>, camera: Camera, tier: Tier, world: EcsWorld, selection: Selection | null): NavState {
  const galaxy = galaxyAt(seed, camera.x, camera.y);
  let system: NavSystem | null = null;
  if (tier === 'system') {
    const focus = nearestSystem(cache, camera.x, camera.y);
    if (focus) {
      system = {
        name: focus.name.scientific,
        humanName: focus.name.human,
        planets: focus.planets.map(p => ({
          name: p.name.scientific,
          humanName: p.name.human,
          moons: p.moons.map(m => ({ name: m.name.scientific, humanName: m.name.human })),
        })),
      };
    }
  }
  return {
    galaxy: galaxy ? { name: galaxy.name, humanName: galaxy.humanName } : null,
    selectedKey: selectionKey(world, selection),
    system,
    tier,
  };
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/nav-state.test.ts`
Expected: PASS.

- [x] **Step 6: Wire into `main.ts`**

Delete `nearestStar`, `buildNavState`, and `selectionKey` from `main.ts`. Import
`nearestSystem` from `./lod/nearest-system` and `buildNavState` from
`./ui/nav-state`. Replace the one `nearestStar(cache, camAbsX, camAbsY)` call in
the frame loop with `nearestSystem(cache, camAbsX, camAbsY)`. Drop now-unused
imports (`SystemData`, `NavState`, `NavSystem`, `Camera` if unused).

- [x] **Step 7: Verify**

Run: `npm run lint:fix && npm run build && npm test`
Expected: all green.

---

### Task 3: Bookmark helpers (`src/bookmarks.ts`)

**Files:**
- Modify: `src/bookmarks.ts`
- Create: `src/bookmarks.test.ts`
- Modify: `src/main.ts` (delete `createBookmarkFromSelection`; simplify
  `onToggleBookmark` / `onBookmarkRemove`)

**Interfaces:**
- Consumes: `selectionFrame(sel, world, originX, originY): Frame | null` (Task 1).
- Produces:
  - `bookmarkFromSelection(sel: Selection, world: EcsWorld, originX: number, originY: number): Bookmark | null`
  - `toggleBookmark(bookmarks: Bookmark[], sel: Selection, world: EcsWorld, originX: number, originY: number): boolean` — mutates in place; true when the list changed.
  - `removeBookmark(bookmarks: Bookmark[], bm: Bookmark): boolean` — mutates in place; true when removed.

In-place mutation is kept because `main.ts` shares one array with the save and
`createBookmarkList.update` already copies it each frame.

- [x] **Step 1: Write the failing tests** in `src/bookmarks.test.ts`:

```ts
import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { GalaxyParams } from './generation/galaxies';
import type { PlanetPhysical } from './generation/planets';
import type { OrbitElements } from './sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it } from 'vitest';

import { bookmarkFromSelection, removeBookmark, toggleBookmark } from './bookmarks';
import { selectionFrame } from './camera/framing';
import { GALAXY_SPRITE_SCALE } from './config/render';
import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef } from './sim/orbits';

// PLANET: copy from src/pick.test.ts. ORBIT: copy from the plan's shared fixtures.

function worldWithPlanet(x: number, y: number): { id: EntityId; world: EcsWorld } {
  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(NameDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(MoonPhysicalDef);
  world.registerComponent(BlackHoleDef);
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x, y });
  world.getStore(PlanetPhysicalDef).set(id, PLANET);
  world.getStore(OrbitElementsDef).set(id, ORBIT);
  world.getStore(NameDef).set(id, { human: 'Aurelia', scientific: 'G2-ABC b' });
  return { id, world };
}

describe('bookmarkFromSelection', () => {
  it('captures a planet at its absolute position with its frame extent', () => {
    const { id, world } = worldWithPlanet(3, 4);
    const bm = bookmarkFromSelection({ id, kind: 'planet' }, world, 1000, 2000);
    expect(bm).toEqual({
      name: 'G2-ABC b',
      extentAu: selectionFrame({ id, kind: 'planet' }, world, 1000, 2000)?.extentAu,
      kind: 'planet',
      label: 'Aurelia',
      x: 1003,
      y: 2004,
    });
  });

  it('captures a galaxy at its centre', () => {
    const { world } = worldWithPlanet(0, 0);
    const galaxy = { centerX: 5, centerY: 6, humanName: 'Andromeda', name: 'NGC 1', radius: 10 } as unknown as GalaxyParams;
    expect(bookmarkFromSelection({ galaxy, kind: 'galaxy' }, world, 0, 0)).toEqual({
      name: 'NGC 1',
      extentAu: 10 * GALAXY_SPRITE_SCALE,
      kind: 'galaxy',
      label: 'Andromeda',
      x: 5,
      y: 6,
    });
  });

  it('captures the universe and rejects streamed-out bodies', () => {
    const { world } = worldWithPlanet(0, 0);
    expect(bookmarkFromSelection({ kind: 'universe', seed: 1 }, world, 0, 0)?.kind).toBe('universe');
    expect(bookmarkFromSelection({ id: 999 as EntityId, kind: 'planet' }, world, 0, 0)).toBeNull();
  });
});

describe('toggleBookmark / removeBookmark', () => {
  it('adds a bookmark, then removes it on the second toggle', () => {
    const { id, world } = worldWithPlanet(0, 0);
    const list: Bookmark[] = [];
    expect(toggleBookmark(list, { id, kind: 'planet' }, world, 0, 0)).toBe(true);
    expect(list.map(b => b.name)).toEqual(['G2-ABC b']);
    expect(toggleBookmark(list, { id, kind: 'planet' }, world, 0, 0)).toBe(true);
    expect(list).toEqual([]);
  });

  it('does nothing for a streamed-out body', () => {
    const { world } = worldWithPlanet(0, 0);
    const list: Bookmark[] = [];
    expect(toggleBookmark(list, { id: 999 as EntityId, kind: 'planet' }, world, 0, 0)).toBe(false);
    expect(list).toEqual([]);
  });

  it('removes by kind and name, not by reference', () => {
    const list: Bookmark[] = [{ name: 'A', extentAu: 1, kind: 'star', label: 'A', x: 0, y: 0 }];
    expect(removeBookmark(list, { name: 'A', extentAu: 9, kind: 'star', label: 'other', x: 5, y: 5 })).toBe(true);
    expect(list).toEqual([]);
    expect(removeBookmark(list, { name: 'A', extentAu: 1, kind: 'star', label: 'A', x: 0, y: 0 })).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/bookmarks.test.ts`
Expected: FAIL — `bookmarkFromSelection` is not exported.

- [x] **Step 3: Implement** — append to `src/bookmarks.ts` (add imports
`import { selectionFrame } from './camera/framing';`,
`import { cameraAbsolute } from './camera/origin';`,
`import { GALAXY_SPRITE_SCALE } from './config/render';`,
`import { SECTOR_SIZE } from './scale';`):

```ts
/**
 * Build a self-contained bookmark from the current selection so it can be
 * zoomed-to and inspected later, even when the body is not streamed. Absolute
 * world positions and the framing extent are captured once.
 */
export function bookmarkFromSelection(sel: Selection, world: EcsWorld, originX: number, originY: number): Bookmark | null {
  if (sel.kind === 'universe')
    return { name: '', extentAu: SECTOR_SIZE * 10, kind: 'universe', label: 'Universe', x: 0, y: 0 };
  if (sel.kind === 'galaxy') {
    return {
      name: sel.galaxy.name,
      extentAu: sel.galaxy.radius * GALAXY_SPRITE_SCALE,
      kind: 'galaxy',
      label: sel.galaxy.humanName,
      x: sel.galaxy.centerX,
      y: sel.galaxy.centerY,
    };
  }
  const frame = selectionFrame(sel, world, originX, originY);
  const identity = world.getStore(NameDef).get(sel.id);
  if (!frame || !identity)
    return null;
  return {
    name: identity.scientific,
    extentAu: frame.extentAu,
    kind: sel.kind,
    label: identity.human,
    x: cameraAbsolute(originX, frame.x),
    y: cameraAbsolute(originY, frame.y),
  };
}

/** Add the selection's bookmark, or remove it if present. True when `bookmarks` changed. */
export function toggleBookmark(bookmarks: Bookmark[], sel: Selection, world: EcsWorld, originX: number, originY: number): boolean {
  const key = selectionBookmarkKey(sel, world);
  if (!key)
    return false;
  const idx = bookmarks.findIndex(b => bookmarkKey(b.kind, b.name) === key);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
    return true;
  }
  const bm = bookmarkFromSelection(sel, world, originX, originY);
  if (!bm)
    return false;
  bookmarks.push(bm);
  return true;
}

/** Remove the bookmark with the same kind + name. True when one was removed. */
export function removeBookmark(bookmarks: Bookmark[], bm: Bookmark): boolean {
  const idx = bookmarks.findIndex(b => bookmarkKey(b.kind, b.name) === bookmarkKey(bm.kind, bm.name));
  if (idx < 0)
    return false;
  bookmarks.splice(idx, 1);
  return true;
}
```

Behaviour note: the old `onToggleBookmark` persisted the save even when nothing
changed; `main.ts` now persists only when `toggleBookmark` returns true. Same
stored data; one fewer redundant write.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bookmarks.test.ts`
Expected: PASS.

- [x] **Step 5: Wire into `main.ts`**

Delete `createBookmarkFromSelection` from `main.ts`. Replace the handlers:

```ts
  const onToggleBookmark = (): void => {
    if (selection && toggleBookmark(bookmarks, selection, world, renderOriginX, renderOriginY))
      persistBookmarks();
  };
```

```ts
  const onBookmarkRemove = (bm: Bookmark): void => {
    if (removeBookmark(bookmarks, bm))
      persistBookmarks();
  };
```

(`selection` becomes `selectionState.selection` in Task 4.) Import
`removeBookmark, toggleBookmark` from `./bookmarks`; drop unused imports.

- [x] **Step 6: Verify**

Run: `npm run lint:fix && npm run build && npm test`
Expected: all green.

---

### Task 4: Selection, lock, and pending bookmark (`src/selection-state.ts`)

**Files:**
- Create: `src/selection-state.ts`
- Create: `src/selection-state.test.ts`
- Modify: `src/main.ts` (replace `selection`, `lockedId`, `pendingBookmark`,
  `pendingBookmarkSelect`, `setSelection`, `toggleLock`, `bookmarkZoomTo`,
  and the frame-loop lock / pending-bookmark blocks)

**Interfaces:**
- Consumes: `lockedBodyLocalPos` (Task 1).
- Produces `class SelectionState` with:
  - `lockedId: EntityId | null` (read-only outside), `selection: Selection | null` (read-only outside)
  - `select(next: Selection | null): void` — replaces the selection; clears lock and pending bookmark.
  - `toggleLock(): void` — planets and moons only.
  - `lockSelectedOrbiter(): void` — lock the selection if it is a planet or moon.
  - `unlock(): void`
  - `cancelPending(): void`
  - `openBookmark(bm: Bookmark, world: EcsWorld, seed: number): EntityId | null` — select the bookmarked target; returns the entity id when it is streamed, otherwise remembers it as pending.
  - `resolvePending(world: EcsWorld): EntityId | null` — once the pending body streams in, select (and lock orbiters) and return its id.
  - `lockedPosition(world: EcsWorld, simSeconds: number): { x: number; y: number; z: number } | null` — the locked body's live position; unlocks and returns null when it streamed out.

Simplification (behaviour-identical): `main.ts` tracks `pendingBookmarkSelect`,
but the only bookmark action is Inspect (`createBookmarkList` exposes
`onInspect` and `onRemove` only), which always sets it to true before a pending
bookmark is read. `SelectionState` therefore always selects a resolved pending
bookmark and drops the flag.

- [x] **Step 1: Write the failing tests** in `src/selection-state.test.ts`:

```ts
import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { OrbitElements } from './sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it } from 'vitest';

import { lockedBodyLocalPos } from './camera/framing';
import { galaxyAt } from './generation/galaxies';
import { NameDef } from './generation/naming';
import { OrbitElementsDef } from './sim/orbits';
import { SelectionState } from './selection-state';

// ORBIT: copy from the plan's shared fixtures.

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(PositionDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(NameDef);
  return world;
}

function addBody(world: EcsWorld, scientific: string, orbiting = true): EntityId {
  const id = world.createEntity();
  world.getStore(PositionDef).set(id, { x: 1, y: 2 });
  world.getStore(NameDef).set(id, { human: scientific, scientific });
  if (orbiting)
    world.getStore(OrbitElementsDef).set(id, ORBIT);
  return id;
}

function bookmark(kind: Bookmark['kind'], name: string, x = 0, y = 0): Bookmark {
  return { name, extentAu: 1, kind, label: name, x, y };
}

describe('SelectionState', () => {
  it('select clears the lock and any pending bookmark', () => {
    const world = makeWorld();
    const s = new SelectionState();
    s.openBookmark(bookmark('planet', 'LATER'), world, 1);
    const id = addBody(world, 'P');
    s.select({ id, kind: 'planet' });
    s.toggleLock();
    expect(s.lockedId).toBe(id);
    s.select(null);
    expect(s.lockedId).toBeNull();
    addBody(world, 'LATER');
    expect(s.resolvePending(world)).toBeNull();
  });

  it('keeps the current selection while a bookmark is pending', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'S', false);
    s.select({ id, kind: 'star' });
    s.openBookmark(bookmark('planet', 'LATER'), world, 1);
    expect(s.selection).toEqual({ id, kind: 'star' });
  });

  it('locks planets and moons but not stars', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const star = addBody(world, 'S', false);
    s.select({ id: star, kind: 'star' });
    s.toggleLock();
    expect(s.lockedId).toBeNull();
    const planet = addBody(world, 'P');
    s.select({ id: planet, kind: 'planet' });
    s.toggleLock();
    expect(s.lockedId).toBe(planet);
    s.toggleLock();
    expect(s.lockedId).toBeNull();
  });

  it('opens a streamed planet bookmark: selects, locks, returns its id', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'P');
    expect(s.openBookmark(bookmark('planet', 'P'), world, 1)).toBe(id);
    expect(s.selection).toEqual({ id, kind: 'planet' });
    expect(s.lockedId).toBe(id);
  });

  it('opens a streamed star bookmark without locking', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'S', false);
    s.openBookmark(bookmark('star', 'S'), world, 1);
    expect(s.selection).toEqual({ id, kind: 'star' });
    expect(s.lockedId).toBeNull();
  });

  it('keeps an unstreamed bookmark pending until the body appears', () => {
    const world = makeWorld();
    const s = new SelectionState();
    expect(s.openBookmark(bookmark('moon', 'M'), world, 1)).toBeNull();
    expect(s.resolvePending(world)).toBeNull();
    const id = addBody(world, 'M');
    expect(s.resolvePending(world)).toBe(id);
    expect(s.selection).toEqual({ id, kind: 'moon' });
    expect(s.lockedId).toBe(id);
    expect(s.resolvePending(world)).toBeNull();
  });

  it('opens the universe bookmark', () => {
    const s = new SelectionState();
    expect(s.openBookmark(bookmark('universe', ''), makeWorld(), 42)).toBeNull();
    expect(s.selection).toEqual({ kind: 'universe', seed: 42 });
  });

  it('opens a galaxy bookmark at the galaxy under its position', () => {
    let seed = 1;
    while (seed < 1000 && !galaxyAt(seed, 0, 0))
      seed++;
    const g = galaxyAt(seed, 0, 0);
    if (!g)
      throw new Error('no seed with a galaxy at the origin');
    const s = new SelectionState();
    s.openBookmark(bookmark('galaxy', g.name, 0, 0), makeWorld(), seed);
    expect(s.selection).toEqual({ galaxy: g, kind: 'galaxy' });
  });

  it('reports the locked body position and unlocks when it streams out', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'P');
    s.select({ id, kind: 'planet' });
    s.lockSelectedOrbiter();
    expect(s.lockedPosition(world, 1000)).toEqual(lockedBodyLocalPos(world, id, 1000));
    world.getStore(OrbitElementsDef).delete(id);
    expect(s.lockedPosition(world, 1000)).toBeNull();
    expect(s.lockedId).toBeNull();
  });
});
```

If `galaxyAt(seed, 0, 0)` equality fails because it returns a fresh object each
call, compare `(s.selection as { galaxy: { name: string } }).galaxy.name` to
`g.name` instead.

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/selection-state.test.ts`
Expected: FAIL — cannot resolve `./selection-state`.

- [x] **Step 3: Implement `src/selection-state.ts`**

```ts
/**
 * What the user has selected, which body the camera is locked to, and a
 * bookmark waiting for its body to stream in. Every change to one of these
 * goes through here so the rules (a new selection drops the lock and any
 * pending bookmark; only planets and moons lock) live in one place.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { Selection } from './pick';

import { lockedBodyLocalPos } from './camera/framing';
import { galaxyAt } from './generation/galaxies';
import { findEntityByName } from './pick';

type BodyBookmarkKind = 'black-hole' | 'moon' | 'planet' | 'star';

export class SelectionState {
  private locked: EntityId | null = null;
  private pending: Bookmark | null = null;
  private selected: Selection | null = null;

  get lockedId(): EntityId | null {
    return this.locked;
  }

  get selection(): Selection | null {
    return this.selected;
  }

  cancelPending(): void {
    this.pending = null;
  }

  /** The locked body's live render-origin-local position; unlocks when it streamed out. */
  lockedPosition(world: EcsWorld, simSeconds: number): { x: number; y: number; z: number } | null {
    if (this.locked === null)
      return null;
    const pos = lockedBodyLocalPos(world, this.locked, simSeconds);
    if (!pos)
      this.locked = null;
    return pos;
  }

  lockSelectedOrbiter(): void {
    const sel = this.selected;
    if (sel && (sel.kind === 'planet' || sel.kind === 'moon'))
      this.locked = sel.id;
  }

  /**
   * Select a bookmark's target. Returns the entity id when the body is already
   * streamed (the caller centres on its live position); otherwise the bookmark
   * stays pending until `resolvePending` finds it.
   */
  openBookmark(bm: Bookmark, world: EcsWorld, seed: number): EntityId | null {
    // Like the old bookmarkZoomTo: drop the lock and any earlier pending
    // bookmark, but keep the current selection until the new one resolves.
    this.locked = null;
    this.pending = null;
    if (bm.kind === 'universe') {
      this.select({ kind: 'universe', seed });
      return null;
    }
    if (bm.kind === 'galaxy') {
      const galaxy = galaxyAt(seed, bm.x, bm.y);
      if (galaxy)
        this.select({ galaxy, kind: 'galaxy' });
      return null;
    }
    const id = findEntityByName(world, bm.name);
    if (id === null) {
      this.pending = bm;
      return null;
    }
    this.selectBody(id, bm.kind);
    return id;
  }

  /** Once a pending bookmark's body has streamed in, select it and return its id. */
  resolvePending(world: EcsWorld): EntityId | null {
    const bm = this.pending;
    if (!bm)
      return null;
    const id = findEntityByName(world, bm.name);
    if (id === null)
      return null;
    this.selectBody(id, bm.kind as BodyBookmarkKind);
    return id;
  }

  select(next: Selection | null): void {
    this.selected = next;
    this.locked = null;
    this.pending = null;
  }

  toggleLock(): void {
    const sel = this.selected;
    if (!sel || (sel.kind !== 'planet' && sel.kind !== 'moon'))
      return;
    this.locked = this.locked === sel.id ? null : sel.id;
  }

  unlock(): void {
    this.locked = null;
  }

  private selectBody(id: EntityId, kind: BodyBookmarkKind): void {
    this.select({ id, kind });
    this.lockSelectedOrbiter();
  }
}
```

Check against old behaviour:
- `setSelection(next)` → `select(next)`: same three resets (the old
  `pendingBookmarkSelect = false` has no counterpart; see the simplification note).
- `onBookmarkInspect` → camera moves in `main.ts` + `openBookmark`: identical
  selection and lock results for all six kinds; the current selection is kept
  while a bookmark is pending, and when `galaxyAt` finds no galaxy, as before.
- Pending resolution → `resolvePending`: same select + lock-orbiter.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/selection-state.test.ts`
Expected: PASS.

- [x] **Step 5: Wire into `main.ts`**

Replace the `let selection`, `let lockedId`, `let pendingBookmark`,
`let pendingBookmarkSelect`, `setSelection`, and `toggleLock` declarations with
`const selectionState = new SelectionState();`, then:

| Old | New |
| --- | --- |
| `setSelection(x)` | `selectionState.select(x)` |
| `toggleLock` (inspector callback) | `() => selectionState.toggleLock()` |
| `selection` (reads) | `selectionState.selection` (bind `const selection = selectionState.selection;` at the top of each handler / frame block that reads it more than once) |
| `lockedId` (reads) | `selectionState.lockedId` |
| `lockedId = null` (lock-drag release) | `selectionState.unlock()` |
| `onZoomTo` lock branch | `selectionState.lockSelectedOrbiter()` |
| `onResetView` lock / pending resets | `selectionState.unlock(); selectionState.cancelPending();` |

Replace `bookmarkZoomTo` and `onBookmarkInspect` with:

```ts
  const onBookmarkInspect = (bm: Bookmark): void => {
    camera.x = bm.x - renderOriginX;
    camera.y = bm.y - renderOriginY;
    camera.zoom = frameZoom(bm.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
    const id = selectionState.openBookmark(bm, world, seed);
    const pos = id === null ? undefined : positions.get(id);
    if (pos) {
      camera.x = pos.x;
      camera.y = pos.y;
    }
  };
```

Replace the frame-loop lock block (the `if (lockedId !== null) { ... }` at the
top of the tick) with:

```ts
    const lockedPos = selectionState.lockedPosition(world, simSeconds);
    if (lockedPos) {
      camera.x = lockedPos.x;
      camera.y = lockedPos.y;
      controller.setFocusZ(lockedPos.z);
    }
```

Replace the pending-bookmark block (`if (pendingBookmark && tier === 'system') { ... }`) with:

```ts
      if (tier === 'system') {
        const resolved = selectionState.resolvePending(world);
        const pos = resolved === null ? undefined : positions.get(resolved);
        if (pos) {
          camera.x = pos.x;
          camera.y = pos.y;
        }
      }
```

Keep the existing comment above that block (why it must run after streaming and
`updateOrbits`). Import `SelectionState` from `./selection-state`; drop unused
imports (`EntityId`, `findEntityByName` if unused).

- [x] **Step 6: Verify**

Run: `npm run lint:fix && npm run build && npm test`
Expected: all green. Also run `grep -n "lockedId\s*=\|pendingBookmark\|let selection" src/main.ts` — expected: no matches.

---

### Task 5: Three backend loading and fallback (`src/render/three-backend.ts`)

**Files:**
- Create: `src/render/three-backend.ts`
- Create: `src/render/three-backend.test.ts`
- Modify: `src/main.ts` (replace `threeRenderer`, `threeLoading`,
  `threeLoadFailed`, `lastThreeActive` and the lazy-load block)

**Interfaces:**
- Produces:
  - `interface ThreeRendererLike { readonly canvas: { style: { display: string } }; readonly failed: boolean; readonly ready: boolean; dispose: () => void; resize: (w: number, h: number) => void }` — `ThreeRenderer` satisfies it structurally.
  - `interface BackendFrame { active: boolean; changed: boolean; threeMode: boolean }`
  - `class ThreeBackend<R extends ThreeRendererLike>`:
    - `constructor(load: () => Promise<R>, mount: (renderer: R) => void)`
    - `renderer: R | null` (getter)
    - `active: boolean` (getter — result of the last `update`)
    - `update(wanted: boolean): BackendFrame` — call once per frame with `renderBackend.value === 'three'`.
    - `resize(w: number, h: number): void`, `dispose(): void`

`threeMode` means "Three is selected and has not failed" (the 2D canvas stays
transparent); `active` means "Three is ready and drawing"; `changed` is true on
the frame `active` flips.

- [x] **Step 1: Write the failing tests** in `src/render/three-backend.test.ts`:

```ts
import type { ThreeRendererLike } from './three-backend';

import { describe, expect, it, vi } from 'vitest';

import { ThreeBackend } from './three-backend';

interface FakeRenderer extends ThreeRendererLike {
  canvas: { style: { display: string } };
  failed: boolean;
  ready: boolean;
}

function fakeRenderer(): FakeRenderer {
  return { canvas: { style: { display: '' } }, dispose: vi.fn(), failed: false, ready: false, resize: vi.fn() };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function setup(load: () => Promise<FakeRenderer>): { backend: ThreeBackend<FakeRenderer>; mount: ReturnType<typeof vi.fn> } {
  const mount = vi.fn();
  return { backend: new ThreeBackend(load, mount), mount };
}

describe('ThreeBackend', () => {
  it('never loads while Canvas 2D is wanted', () => {
    const load = vi.fn(async () => fakeRenderer());
    const { backend } = setup(load);
    expect(backend.update(false)).toEqual({ active: false, changed: false, threeMode: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('loads once, stays in threeMode while loading, and activates when ready', async () => {
    const r = fakeRenderer();
    const load = vi.fn(async () => r);
    const { backend, mount } = setup(load);
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: true });
    backend.update(true);
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(mount).toHaveBeenCalledWith(r);
    expect(backend.update(true).active).toBe(false);
    expect(r.canvas.style.display).toBe('none');
    r.ready = true;
    expect(backend.update(true)).toEqual({ active: true, changed: true, threeMode: true });
    expect(backend.update(true).changed).toBe(false);
    expect(r.canvas.style.display).toBe('block');
    expect(backend.active).toBe(true);
  });

  it('falls back to Canvas 2D without retrying when the chunk fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(async () => {
      throw new Error('network');
    });
    const { backend } = setup(load);
    backend.update(true);
    await flush();
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: false });
    backend.update(true);
    expect(load).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('falls back to Canvas 2D when the renderer fails to initialise', async () => {
    const r = fakeRenderer();
    const { backend } = setup(async () => r);
    backend.update(true);
    await flush();
    r.failed = true;
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: false });
    expect(r.canvas.style.display).toBe('none');
  });

  it('deactivates and hides its canvas when Canvas 2D is chosen again', async () => {
    const r = fakeRenderer();
    const { backend } = setup(async () => r);
    backend.update(true);
    await flush();
    r.ready = true;
    backend.update(true);
    expect(backend.update(false)).toEqual({ active: false, changed: true, threeMode: false });
    expect(r.canvas.style.display).toBe('none');
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/render/three-backend.test.ts`
Expected: FAIL — cannot resolve `./three-backend`.

- [x] **Step 3: Implement `src/render/three-backend.ts`** (logic moved from
the `main.ts` block under "Rendering backend: lazily stand up the Three.js
renderer"):

```ts
/**
 * Lifecycle of the optional Three.js renderer: load its chunk the first time it
 * is wanted, show its canvas only once it is ready, and fall back to Canvas 2D
 * for the rest of the session if loading or initialisation fails. The loader is
 * injected so this module never imports Three itself (the chunk stays lazy).
 */

/** The parts of `ThreeRenderer` this lifecycle needs. */
export interface ThreeRendererLike {
  readonly canvas: { style: { display: string } };
  readonly failed: boolean;
  readonly ready: boolean;
  dispose: () => void;
  resize: (w: number, h: number) => void;
}

/** Per-frame backend state. */
export interface BackendFrame {
  /** Three is ready and draws this frame. */
  active: boolean;
  /** `active` differs from the previous frame. */
  changed: boolean;
  /** Three is selected and has not failed: keep the 2D canvas transparent. */
  threeMode: boolean;
}

export class ThreeBackend<R extends ThreeRendererLike> {
  private lastActive = false;
  private readonly load: () => Promise<R>;
  private loadFailed = false;
  private loading = false;
  private readonly mount: (renderer: R) => void;
  private current: R | null = null;

  constructor(load: () => Promise<R>, mount: (renderer: R) => void) {
    this.load = load;
    this.mount = mount;
  }

  get active(): boolean {
    return this.lastActive;
  }

  get renderer(): R | null {
    return this.current;
  }

  dispose(): void {
    this.current?.dispose();
  }

  resize(w: number, h: number): void {
    this.current?.resize(w, h);
  }

  /** Advance one frame; `wanted` is whether the user selected the Three backend. */
  update(wanted: boolean): BackendFrame {
    const failed = this.loadFailed || (this.current?.failed ?? false);
    const threeMode = wanted && !failed;
    if (threeMode && !this.current && !this.loading) {
      this.loading = true;
      this.load().then((renderer) => {
        this.current = renderer;
        this.mount(renderer);
      }).catch((error: unknown) => {
        // Fall back to Canvas 2D rather than re-requesting the chunk every frame;
        // a page reload retries.
        this.loadFailed = true;
        this.loading = false;
        console.error('ProcUniverse: failed to load the Three.js backend.', error);
      });
    }
    const active = threeMode && this.current !== null && this.current.ready;
    if (this.current)
      this.current.canvas.style.display = active ? 'block' : 'none';
    const changed = active !== this.lastActive;
    this.lastActive = active;
    return { active, changed, threeMode };
  }
}
```

`npm run lint:fix` reorders the class properties; that is expected.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render/three-backend.test.ts`
Expected: PASS.

- [x] **Step 5: Wire into `main.ts`**

Replace `let threeRenderer`, `let threeLoading`, `let threeLoadFailed` with
(after `canvas` is created):

```ts
  // Three.js renderer: loaded on first use (so Canvas 2D sessions never download
  // the three bundle) and mounted behind the transparent 2D HUD canvas.
  const threeBackend = new ThreeBackend<ThreeRenderer>(
    () => import('./render/three/three-renderer').then(({ ThreeRenderer }) => {
      const r = new ThreeRenderer();
      r.resize(canvas.width, canvas.height);
      return r;
    }),
    (r) => {
      container.insertBefore(r.canvas, canvas);
    },
  );
```

In `sizeCanvas`: `threeRenderer?.resize(...)` → `threeBackend.resize(canvas.width, canvas.height)`.
Note `sizeCanvas` runs before `threeBackend` is declared — declare `threeBackend`
above `sizeCanvas` (it only captures `canvas`/`container`, which exist).

Replace the whole block from `const threeFailed = ...` through
`lastThreeActive = threeActive;` with:

```ts
    const backend = threeBackend.update(renderBackend.value === 'three');
    const { threeMode } = backend;
    const threeActive = backend.active;
    const backendChanged = backend.changed;
    const threeRenderer = threeBackend.renderer;
```

Keep the comment above it (trimmed to what `main.ts` still decides). Delete
`let lastThreeActive`. In `onPickUp`, replace the system-tier branch with:

```ts
    if (currentTier === 'system') {
      const three = threeBackend.renderer;
      if (threeBackend.active && three)
        selectionState.select(three.pickAt(bx, by));
      else
        selectionState.select(pickBodyAt(world, localCam, bx, by));
    }
```
 In teardown,
`threeRenderer?.dispose()` → `threeBackend.dispose()`. `ThreeRenderer` stays a
type-only import in `main.ts`.

Behaviour note: picking used "Three selected and ready"; `threeBackend.active`
is "Three selected, not failed, and ready" as of this frame — identical except
when the renderer failed, where `ready` is false anyway.

- [x] **Step 6: Verify**

Run: `npm run lint:fix && npm run build && npm test`
Expected: all green. Run `npm run build` and confirm the Three chunk is still a
separate output file (the `three-renderer-*.js` chunk appears in the Vite output
list; the main bundle must not grow by ~700 kB).

---

### Task 6: Docs, roadmap, final checks

**Files:**
- Modify: `docs/codebase.md`, `docs/roadmap.md`, `docs/plans/main-ts-split.md`

- [x] **Step 1: `docs/codebase.md`** — add rows:

```md
| `src/selection-state.ts` | Selection, camera lock, and pending-bookmark state (`SelectionState`): one place for the rules that tie them together. |
```

and extend existing rows: `src/camera/` gains "framing (`selectionFrame`,
`frameSelection`, lock position)"; `src/lod/` gains "`nearestSystem`";
`src/ui/` gains "`nav-state.ts` builds the location-tree state"; `src/render/`
gains "`three-backend.ts` (lazy Three load, activation, Canvas 2D fallback)";
`src/bookmarks.ts` gains "creation, toggle, and removal". Update the
`src/main.ts` row to: "Entry: canvas and DPR sizing, ECS world, input handlers,
and the per-frame loop (origin rebase, streaming, render dispatch, HUD) wiring
the modules above."

- [x] **Step 2: `docs/roadmap.md`** — in "Engineering health", replace the
"Split `src/main.ts`" bullet with the remaining follow-ups (deferred from this
plan, so they need this durable home):

```md
- Split the `main.ts` frame loop into stages (origin rebase + streaming, render
  dispatch per tier, selection reticle, HUD) and move canvas / DPR sizing into
  its own module.
- Bookmark panel re-renders every frame (`createBookmarkList.update` copies the
  array each tick); push only on change.
```

- [x] **Step 3: Full verification**

Run: `npm run build && npm test && npm run lint`
Expected: all green. Record `wc -l src/main.ts` (expected roughly 1082 → ~700).

- [x] **Step 4: Peer review** (fast model, per AGENTS.md): whole-diff review for
behaviour preservation against the "Behaviour note" of each task. Fix findings.

- [x] **Step 5: Hand off to Pierre** the Review Focus browser checklist above.

- [x] **Step 6: Close the plan** — tick all boxes here and `git mv` this file to
`docs/plans/done/` (in the same commit as the final change, when Pierre asks
to commit).
