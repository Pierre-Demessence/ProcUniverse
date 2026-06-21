# Procedural Universe — Plan & Design

A 2D, top-down, effectively-infinite procedurally generated universe rendered
on a flat plane. Pan and zoom continuously from a single planetary system out
to a galaxy-scale field of (potentially) millions of systems, with planets
orbiting their stars in real time. Built on the sibling `@pierre/ecs` engine.
No N-body gravity — orbits are analytic.

## 1. Confirmed decisions

- **2D flat plane, top-down.** Not a globe; "plane" means flat space viewed
  from above.
- **Engine:** consume `@pierre/ecs` via a `file:` dependency (no build step;
  edits in the engine repo are picked up live).
- **Canvas 2D first**, behind the engine's `Renderer<TCtx>` interface. The
  engine ships a culling-aware `Canvas2DRenderer` plus a `camera` module
  (zoom, limits, follow). The `Renderer` interface explicitly anticipates
  `WebGL` / `PIXI` backends, so a GPU starfield renderer can be dropped in
  later for the dense zoom tiers without touching generation or simulation.
- **Universe as a pure function** of `(seed, coordinates)`: generate on
  demand, regenerate deterministically, never store generated content.
- **Persist only** the world seed plus player deltas (via `modules/save`).
- **Orbits are analytic** (closed-form Kepler), computed only for on-screen
  systems.
- **Viewer is a free-floating camera** (pan/zoom anywhere) for v1 — no
  ship/avatar.
- **Deepest zoom tier is the planetary system** (star + orbiting planets); no
  planet-surface view.

## 2. Core architecture

### 2.1 Universe as a function

Content is derived, never stored: `f(worldSeed, cellCoords) -> content`. Each
cell mixes its coordinates with the world seed to get a per-cell seed, fed to
`makeSeededRng` (deterministic mulberry32). Regenerating a cell always yields
an identical result, so the universe *feels* persistent without being saved.
At most a few thousand entities are ever alive — whatever overlaps the
viewport at the current zoom. The rest is a formula waiting to be evaluated.

### 2.2 Level-of-Detail hierarchy (the scalability backbone)

A pyramid of scales. At each zoom tier the representation switches so that the
number of things drawn stays bounded (low thousands) regardless of how many
systems exist. We never draw a million points; when a million systems would
map to one screen region, we draw an aggregate instead.

| Tier | What's on screen | What we draw |
| ---- | ---------------- | ------------ |
| T0 System | one planetary system | star, planets, moons, orbit rings (individual, animated) |
| T1 Sector | many systems | each system = one star dot; no planets |
| T2 Region | many sectors | sector = cluster dot / star-count |
| T3 Galaxy | the whole field | density field sprite (aggregate), not individuals |

The active tier is chosen from camera zoom. Only cells overlapping the
viewport at that tier are ever evaluated.

### 2.3 Streaming and regeneration

Each frame: compute the cells overlapping the camera rect (`ContinuousHashGrid2D`
plus the `cellsForAabb` / `cellOfPoint` projection helpers), generate
newly-visible cells (spawn entities), and despawn cells that just left the
rect (`queueDestroy` / `flushDestroys`). Because regeneration is
deterministic, a returning cell is byte-identical to before.

### 2.4 Floating origin

Galaxy-scale coordinates with planet-scale detail exceed float64's usable
precision and produce jitter. We keep working coordinates relative to the
current sector and rebase as the camera travels (camera-relative rendering).
Designed in from the start — retrofitting it later is painful.

### 2.5 Analytic orbits

Each planet stores an orbital radius `a` and phase `theta0`. Its position is a
pure function of a global clock `t`:

$$\theta(t) = \theta_0 + \omega t, \quad \omega = k\,a^{-3/2}\ \text{(Kepler's 3rd law)}$$

$$\vec{p}_{\text{planet}}(t) = \vec{p}_{\text{star}} + a\,(\cos\theta(t),\ \sin\theta(t))$$

Computed only for instantiated (on-screen) systems, O(1) per planet. Systems
stay static within their cell for v1: real galactic rotation is ~225 million
years per turn, so stars are effectively fixed relative to one another at any
playable timescale. A slow cosmetic rigid rotation of the whole field can be
added later, but systems must never drift out of their generating cell — that
would break determinism.

## 3. Engine mapping

| Need | Engine piece |
| ---- | ------------ |
| Deterministic generation | `makeSeededRng`, `randomInt`, `pick` (`modules/rng`) |
| Sector binning / streaming | `ContinuousHashGrid2D`, `cellsForAabb`, `cellOfPoint` (`modules/spatial`) |
| Zoom + culling | `Canvas2DRenderer` `view`, `modules/camera` (zoom, limits, follow) |
| Entity lifecycle | `spawn`, `queueDestroy`, `flushDestroys` (`world`) |
| Prefabs | `EntityTemplate`, `composeTemplates` (star / planet / system) |
| Cross-entity references | `registryComponent` (planet -> owning star) |
| Orbit data | `simpleComponent` (radius, phase, angular speed) |
| Render loop | `AnimationFrameTickSource` (`modules/tick`) |
| Persist seed + deltas | `modules/save` (`LocalStorageBackend` / `IndexedDBBackend`) |
| Perf HUD | `drawStatsOverlay`, `FrameStats`, `TimedTickSource` (`modules/stats`) |
| Zoom blending math | `lerp`, `smoothstep`, `clamp`, `remap` (`modules/math`) |
| Deep-zoom world swap (optional) | `SceneTransitionQueue` (`modules/scene-transition`) |

The only genuinely new code is the **LOD tier selector**, the **per-tier
deterministic generators**, the **floating-origin rebasing**, and (eventually)
the **WebGL starfield renderer**.

## 4. Proposed project structure

```text
ProcUniverse/
  index.html
  package.json            # @pierre/ecs as a file: dependency
  tsconfig.json
  vite.config.ts
  src/
    main.ts               # canvas, tick loop, wiring
    generation/           # per-tier deterministic generators + hashing
    lod/                  # tier selection + visible-cell computation
    sim/                  # analytic orbit system
    render/               # Renderer adapters (canvas2d now, webgl later)
    camera/               # pan/zoom input + floating origin
    persistence/          # seed + player deltas
  docs/
    INDEX.md
    tech-stack.md
    codebase.md
    features.md
    agent/README.md
    plans/                # this file lives here until done
```

## 5. Phased implementation plan

### Phase 0 — Scaffold

- [x] Vite + TypeScript project; `@pierre/ecs` `file:` dependency; tsconfig;
      `.gitignore`. (ESLint deferred — not yet wired.)
- [x] Canvas + `AnimationFrameTickSource` + `camera` with mouse/trackpad
      pan and zoom; `drawStatsOverlay` FPS HUD. ("Hello world" = a draggable,
      zoomable empty plane showing FPS.) Browser-validated at 75 fps with
      zoom-to-cursor and a bounded adaptive grid across the full zoom range.
- [x] Mandatory docs skeleton (`README.md`, `docs/INDEX.md`,
      `docs/tech-stack.md`, `docs/codebase.md`, `docs/features.md`,
      `docs/agent/README.md`).

### Phase 1 — One sector + live orbits (vertical slice)

- [x] Deterministic system generator: sector seed -> N systems with positions,
      star sizes/colors. (`src/generation/`, covered by a vitest determinism
      test.)
- [x] Star and planet templates; analytic orbit component + orbit system.
      (`OrbitDef` + `updateOrbits` in `src/sim/orbits.ts`.)
- [x] Render one sector of systems with planets visibly orbiting; pan/zoom
      within it. (Orbit rings + camera framing on the first system.)
- [x] Validate: regenerating the sector is identical; 60 fps. (Browser-verified
      at 75 fps with 12 systems / 41 planets; determinism asserted by tests.)

### Phase 2 — Streaming + LOD

- [ ] Sector-grid streaming: visible-cell computation, spawn/despawn on
      entry/exit.
- [ ] LOD tier selector from zoom; representation swap (system <-> star-dot).
- [ ] Floating-origin rebasing as the camera travels.
- [ ] Verify bounded draw count across the full zoom range.

### Phase 3 — Deep zoom-out aggregates

- [ ] Region / galaxy tiers: density-field / aggregate rendering.
- [ ] Smooth tier transitions (cross-fade via `smoothstep`).
- [ ] "Turbo zoom out" stress test — confirm constant frame cost.

### Phase 4 — Persistence & identity

- [ ] Persist the world seed; deterministic naming of systems / stars.
- [ ] Player deltas (visited / named) via `modules/save`.
- [ ] Reload -> identical universe.

### Phase 5 (optional) — WebGL dense tier

- [ ] Implement a `Renderer<TCtx>` WebGL/PIXI backend for the star-dot tiers
      (instanced points/sprites).
- [ ] Hybrid: Canvas for orbits/UI, WebGL for the dense starfield.

## 6. Open questions

These shape scope and are worth resolving before or during Phase 0:

- **Timescale:** how fast do planets visibly orbit — near real-time, or
  accelerated so motion is obvious?
- **Deepest zoom:** stop at the system level, or also zoom *into* a planet
  (a surface / biome view)? "Flat plane" leans toward stopping at the system,
  but confirm.
- **Player presence:** a free-floating camera sandbox, or a ship/avatar that
  travels (with the camera following it)?
- **Scale targets:** systems per sector and sectors per galaxy — sets density
  and the perf budget.
- **Aesthetic:** realistic (star color by temperature, nebulae) vs. stylized.
- **Goal for v1:** pure exploration sandbox, or early gameplay hooks?

## 7. Validation strategy

- **Determinism test:** generate a cell twice and assert an identical entity
  set.
- **Performance:** stats HUD on; target 60 fps at every tier; dedicated
  "turbo zoom" stress scene.
- **Browser E2E:** exercise pan, zoom across tiers, and reload-persistence in
  a real browser before calling any phase done (static checks alone are not
  sufficient for a real-time renderer).
