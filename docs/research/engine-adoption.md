# Engine Adoption — unused `@pierre/ecs` features

Where ProcUniverse still hand-rolls something the engine provides, and which
engine features fit upcoming work. Source of truth for the engine surface:
`../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`. Actionable items
are also listed in [roadmap.md](../roadmap.md).

## Current usage

The project uses the engine as a toolbox: `EcsWorld` and component stores,
`simpleComponent`, the world plugin (`src/world-plugin.ts`), the 2D camera
transforms, `math` / `rng` helpers, `projectPointer`, `Canvas2DRenderer`,
`AnimationFrameTickSource`, `FrameStats`, and the frame loop itself: `Scheduler`
systems in `src/frame/` (lock, tier, origin rebase, streaming, orbits,
rendering, HUD) driven by a `TickRunner`, with the step order pinned by a test.

## Structural opportunities

### `Scene3DRenderer` for the Three.js system view

`@pierre/ecs/modules/render-scene3d` keeps one scene-graph object per selected
entity: created on first selection, synced each frame, removed when the entity
leaves. `ThreeRenderer` manages the same lifecycle by hand with index-based
pools (`pool`, `starSpherePool`, `planetRingPool`). Adopting it fits the
roadmap item "Split `ThreeRenderer.render()`".

### `Position3DDef` instead of `PositionZDef`

Bodies carry the engine's 2D `PositionDef` plus a project `PositionZDef`
because the Canvas 2D renderer reads only `PositionDef`. The engine's
`@pierre/ecs/modules/transform-3d` provides `Position3DDef` (and
`Rotation3DDef`). Switch once Canvas 2D is retired; before that, both
components would need keeping in sync.

## Feature-driven opportunities

| Roadmap item | Engine feature |
| ------------ | -------------- |
| Smooth fly / warp-to-target | `modules/tween` + `modules/easing`; `camera-3d` `dampPose` / `smoothingBlend` (frame-rate-independent exponential smoothing). |
| Cosmic-web / nebula visuals | `modules/noise`: `fbm2D`, `simplex2D`, `perlin2D`. |
| Player deltas (persistence) | `modules/save`: `LocalStorageBackend` (tmp-write verification), `MigrationRegistry` (versioned save upgrades), checksummed envelopes. Its storage API is async, while the session save is written synchronously on `beforeunload`; keep that path synchronous. |
| Performance budget | `modules/worker-pool` (`WorkerPool` / `handleJobs`) to move `generateSectorData` off the main thread if sector generation stutters; `SectorCache.get` is synchronous today, so this needs an async fill path. |
| Tier cross-fade | `modules/timer` for the `fadeMsLeft` countdown (minor). |

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
