# Engine Adoption — unused `@pierre/ecs` features

Where ProcUniverse still hand-rolls something the engine provides, and which
engine features fit upcoming work. Source of truth for the engine surface:
`../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`. Actionable items
are also listed in [roadmap.md](../roadmap.md).

## Current usage

The project uses the engine as a toolbox: `EcsWorld` and component stores,
`simpleComponent`, the world plugin (`src/world-plugin.ts`), `Position3DDef`
(`modules/transform-3d`) for body positions, the 2D camera transforms, `math` /
`rng` helpers, `projectPointer`, `AnimationFrameTickSource`, `FrameStats`, and
the frame loop itself: `Scheduler` systems in `src/frame/` (lock, tier, origin
rebase, streaming, orbits, rendering, HUD) driven by a `TickRunner`, with the
step order pinned by a test. Systems that only apply at the system tier or once
Three is ready declare it with the scheduler's `runIf` run condition.

The Three.js system view uses `Scene3DRenderer`
(`@pierre/ecs/modules/render-scene3d`): `src/render/three/body-passes.ts` runs
one pass each for stars, planets, moons, black holes and planet rings. A pass
creates a mesh when a body is first selected, syncs it every frame, and hands
it back through the engine's `remove` callback to a `RecyclePool`, so meshes and
their GPU materials are recycled as sectors stream in and out.

## Feature-driven opportunities

| Roadmap item | Engine feature |
| ------------ | -------------- |
| Smooth fly / warp-to-target | `modules/tween` + `modules/easing`; `camera-3d` `dampPose` / `smoothingBlend` (frame-rate-independent exponential smoothing). |
| Cosmic-web / nebula visuals | `modules/noise`: `fbm2D`, `simplex2D`, `perlin2D`. |
| Player deltas (persistence) | `modules/save`: `LocalStorageBackend` (tmp-write verification), `MigrationRegistry` (versioned save upgrades), checksummed envelopes. Its storage API is async, while the session save is written synchronously on `beforeunload`; keep that path synchronous. |
| Performance budget | `modules/worker-pool` (`WorkerPool` / `handleJobs`) to move `generateSectorData` off the main thread if sector generation stutters; `SectorCache.get` is synchronous today, so this needs an async fill path. |

## Deliberately not adopted

- **Entity templates for `spawnSector`.** Every component value is per-body
  data, so a template would be empty and all data would move into string-keyed,
  untyped overrides — losing the compile-time checks of typed `store.set`.
- **Engine math / noise inside generation.** `generation/galaxies.ts`
  (`smoothstep`, cosmic-web value noise) and `generation/hash.ts` must stay
  bit-identical: any numeric change reshuffles every existing universe for its
  seed. Use engine noise only for *new* generated or visual features.
- **`HashGrid2D` for picking.** Streamed body counts at the system tier are
  small; a linear scan is fine.
- **`camera-3d` orbit rig.** The 3D camera is anchored to the focused system's
  tilted orbital plane, which the generic yaw/pitch `OrbitRig` does not model.
- **Game-specific modules** (behaviour tree, FSM, GOAP, pathfinding, tilemap,
  piles, kinematics, collision, particles, audio): no current use.
