# Agent Operational Notes

Concise, machine-oriented facts for working in this repository. Chat and
testing rules are in [AGENTS.md](../../AGENTS.md).

## Purpose

A procedural universe explorer built on `@pierre/ecs`. Free-floating camera (no
ship/avatar). Zoom tiers run from the cosmic web down to a planetary system;
the system and star tiers are one blended 3D perspective view (Three.js).
There is no planet-surface landing view.

## Commands

- `npm install` — install dependencies (links the sibling `@pierre/ecs`).
- `npm run dev` — Vite dev server on port 5180 (Pierre's browser testing only).
  The planet lab is at `/lab.html` (dev only; Pierre tunes surface looks there).
- `npm run build` — `tsc --noEmit` then Vite production build.
- `npm test` — Vitest suite.
- `npm run lint` / `npm run lint:fix` — ESLint (antfu config).

Before handing off: `npm run build`, `npm test`, and `npm run lint` must pass.

## Key paths

- Engine (sibling): `../Entity-Cornponent-System-Engine`.
- Engine API catalog (read first): `../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`.
- CI engine pin: the `ref:` in `.github/actions/setup/action.yml`. After
  adapting to an engine change, bump it to a **pushed** engine commit in the
  same commit as the adaptation.
- Roadmap (living backlog): `docs/roadmap.md`. In-flight plans: `docs/plans/`;
  finished plans: `docs/plans/done/`.
- Tuning knobs: `src/config/data.ts` (generation) and `src/config/render.ts`
  (camera, LOD, visuals).

## Invariants

- The universe is a pure function of `(seed, coords)`. Never persist generated
  content — only the world seed and player state. New sampled fields append to
  a body's RNG draw order; never reorder draws.
- Orbits are analytic (no N-body simulation). Systems stay static within their
  generating cell.
- Camera and pointer math run in canvas backing pixels; keep
  `camera.viewportW/H == canvas.width/height`.
- Renderers receive render-origin-relative coordinates, never raw absolutes.
- Generation is 3D: sectors are cubes (`LY_PER_SECTOR` ly, keyed
  `(sx, sy, sz)`), galaxies sit in 3D cells with their own disk normal, and
  every density / activity / galaxy lookup takes `(x, y, z)`. Stars are placed
  by Poisson-count thinning against `galaxyDensityBoundAt`; keep that bound a
  true upper bound of `galaxyDensityOf` (a property test pins it). Tier
  thresholds are in light-years (`*_LY`), independent of the sector size. The
  galaxy / galaxy-field / universe tiers still render top-down: they show the
  density slice, or a box of space at most one galaxy cell deep
  (`galaxyFieldHalfDepth`, shared by the glow, labels and picking), around the
  focus height (`ctx.camAbsZ`) until [universe-3d.md](../plans/universe-3d.md)
  Phases 3–5 land. Zoomed out, the origin rebases z with x / y, so
  `controller.focusZ` stays small too.
- Rendering blends system and star layers by `ctx.blend` (`tierBlend`, 0 → 1
  across `STAR_BLEND_MIN_AU`–`STAR_BLEND_MAX_AU`); the discrete tier still
  drives selection, HUD and picking. While `blend < 1` (`hasSystemLayer`)
  systems stay streamed, orbiting and origin-anchored even at the star tier.
  The band must enclose the tier hysteresis (pinned by `tier.test.ts`).
- While the system layer shows, the render origin is the focused star
  (x, y **and** z: `renderOriginZ`), so bodies sit tens
  of AU out while zoom reaches ~150 m/px. `controller.focusZ` is local to
  `renderOriginZ` (rebased with it); the save and bookmarks store absolute z. The Three renderer runs with
  `highPrecision` (float64 CPU model-view) and a reversed float depth buffer.
  Never feed float32 world positions (`positionWorld`, `cameraPosition`, raw
  vertex buffers) into close-up maths: use object-local offsets or buffers
  relative to the focus (see orbit rings, atmosphere, ring shadow). Clip labels
  on view-space depth, not NDC z (reversed depth maps far to 0).
- Three.js (`src/render/three/`) is the only scene renderer. The 2D canvas is a
  transparent overlay for labels, the reticle and the HUD; it is cleared every
  frame by the `overlay-clear` step.
- Bodies carry the engine `Position3DDef` and the project `BodyVisualDef`
  (colour + zoom-floored radius, rewritten each frame by `applyBodyScale`).
- Generation and sim never import Three.js; render reads the ECS world one-way.
- The frame loop is `src/frame/` systems on an engine `Scheduler`, driven by a
  `TickRunner`. Step order encodes past bug fixes and is pinned by
  `src/frame/pipeline.test.ts`. `world.endOfTick()` stays inside the `streaming`
  system because `orbits` reads what streaming just spawned.
- System-tier body meshes come from `BodyPasses` (`src/render/three/body-passes.ts`).
  Unused pooled meshes are detached from `group`, so `ThreeRenderer.pickAt` only
  sees live bodies. Pass order in `render()` is stars → star light → planets,
  rings, moons, black holes (rings read the star light). A world reset must call
  `bodyPasses.releaseAll()` because entity ids restart. `Scene3DRenderer` calls
  a pass's `select` once per world and re-iterates the result every frame, so a
  selection must be re-iterable (`makePass` wraps the generator selectors).
- In the cross-fade band the far plane reaches the star field, so
  `BodyPasses` hides bodies beyond `SYSTEM_LAYER_REACH_AU` of the origin
  (neighbouring systems; black holes exempt) and body labels are filtered the
  same way.
- The orbit camera's plane basis comes only from `planeBasis`
  (`src/camera/plane-basis.ts`); the renderer and the controller's pan must
  agree on it. The star-tier tilt easing (`setTiltScale`) latches its target
  pose (top-down or bottom-up) when the easing starts; re-picking it per frame
  flips the camera when the tilt is dragged through 90°.
- Star-tier sector generation is budgeted (`STAR_SECTOR_BUDGET_MS`, via
  `SectorCache.peek`); never call `cache.get` for every sector in a star-tier
  range. `SectorCache` evicts the least recently read sector (every `get` /
  `peek` hit refreshes it), so the sectors in range stay cached while the range
  fits the capacity (recency pinned by `sector-cache.test.ts`, range ≤ capacity
  by `tier.test.ts`).
- The star-tier reach (`starFieldReach`) and the labelled / spiked stars
  (`starRankLevel`, brightness seen from the focus) depend on zoom and focus
  only, never on the camera's tilt or orbit, so rotating never adds, drops or
  relabels stars. Sprite brightness and size still use the camera distance.
  The focused star is matched by `isSameSystem` (name and position), not by its
  catalogue name, which can repeat in view.
- `ThreeRenderer.updateStarfield` runs at the system tier only, with absolute
  coordinates (the star tier calls `ensureStarfield`, which fills it once). A starfield rebuild samples ~10⁵ galaxy lookups (hundreds of
  ms) plus a ~30 ms sky-structure bake, and the zoomed-out tiers would cross its
  ~50,000 AU cache buckets every frame.
- The starfield band sphere is unrotated: its shader derives the world
  direction from `positionLocal` and must use the same equirectangular
  convention as `sky-structure.ts` (`pixelToDir` / `dirToUv`), or the band and
  the stars disagree.
- No agent browser/E2E testing — hand in-browser verification to Pierre.
- Planet surface looks are tuned by Pierre in the planet lab (`src/lab/`); the
  agent turns the copied lab JSON into `src/config/render.ts` defaults. The app
  never imports `src/lab/`, and the lab stays out of the production build.
