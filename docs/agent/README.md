# Agent Operational Notes

Concise, machine-oriented facts for working in this repository. Chat and
testing rules are in [AGENTS.md](../../AGENTS.md).

## Purpose

A procedural universe explorer built on `@pierre/ecs`. Free-floating camera (no
ship/avatar). Zoom tiers run from the cosmic web down to a planetary system;
the system tier is 3D (Three.js). There is no planet-surface landing view.

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
- At the system tier the render origin is the focused star, so bodies sit tens
  of AU out while zoom reaches ~150 m/px. The Three renderer runs with
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
- `ThreeRenderer.updateStarfield` runs at the system tier only, with absolute
  coordinates. A starfield rebuild samples ~10⁵ galaxy lookups (hundreds of
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
