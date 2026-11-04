# AGENTS.md

Agent operating notes for **ProcUniverse**: a procedural universe explorer
built on `@pierre/ecs`. Free-floating camera (no ship/avatar). Zoom tiers run
from the cosmic web down to a planetary system, all seen through one 3D
perspective camera (Three.js); the system and star tiers are one blended view.
There is no planet-surface landing view.

## Communication in chat

Keep **in-session answers to Pierre in plain language** — avoid heavy
scientific / mathematical jargon and unexplained symbols. Pierre wants to
understand and agree with recommendations, not trust them blindly.

- Lead with a plain-English explanation (analogies welcome); introduce a
  technical term only after saying what it means in ordinary words.
- If unsure how much detail Pierre wants, ask — e.g. offer explanations at a
  couple of levels and let him pick which lands, or ask what he already knows.

This applies to **chat answers only**. Written **plans and docs** may use normal
technical terminology, since other people and agents read them too.

## Commands

- `npm install` — install dependencies (links the sibling `@pierre/ecs`).
- `npm run dev` — Vite dev server on port 5180 (Pierre's browser testing only).
  The planet lab is at `/lab.html` (dev only; Pierre tunes surface looks there).
- `npm run build` — `tsc --noEmit` then Vite production build.
- `npm test` — Vitest suite (`*.test.ts` next to their modules).
- `npm run lint` / `npm run lint:fix` — ESLint (`@antfu/eslint-config`).

Before handing off: `npm run build`, `npm test`, and `npm run lint` must pass.

## Docs map

- [README.md](README.md) — what it is, install, run, controls.
- [docs/features.md](docs/features.md) — shipped features, by area.
- [docs/codebase.md](docs/codebase.md) — what each source folder holds and
  where new code goes.
- [docs/physics.md](docs/physics.md) — how the generated astrophysics works,
  with sources.
- [docs/backlog.md](docs/backlog.md) — everything not done (`B<n>`).
- [docs/decisions.md](docs/decisions.md) — why things are the way they are
  (`D<n>`).
- [docs/research/](docs/research/) — undecided options and reference research.
- [docs/plans/](docs/plans/) — in-flight plans; a finished plan is deleted.

## Stack and key paths

- Engine: sibling checkout `../Entity-Cornponent-System-Engine`, consumed as a
  `file:` dependency. Read its API catalog first:
  `../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`, and prefer
  engine modules over hand-rolled helpers.
- CI engine pin: the `ref:` in `.github/actions/setup/action.yml`. Locally the
  engine is whatever the sibling folder holds; CI and the itch.io publish check
  out the pinned commit. After adapting to an engine change, bump the ref to a
  **pushed** engine commit in the same commit as the adaptation.
- CI (lint, test, build) runs on pushes and PRs to `main`; the itch.io publish
  runs only after CI succeeds for a push to `main`.
- Three.js (`three/webgpu`, WebGPU with automatic WebGL2 fallback) is
  lazy-loaded as its own chunk; if it cannot load or initialise, the page shows
  a notice (`src/ui/render-failure.ts`).
- HUD overlays are Preact + `@preact/signals` (JSX via `@preact/preset-vite`,
  `jsxImportSource: preact`); the canvas / ECS loop stays imperative.
- `lil-gui` is a devDependency used only by the planet lab.
- Tuning knobs: `src/config/data.ts` (generation) and `src/config/render.ts`
  (camera, LOD, visuals).

## Conventions

- TypeScript with ES modules and `verbatimModuleSyntax` — use `import type`
  for type-only imports.
- Planet surface looks are tuned by Pierre in the planet lab (`src/lab/`); the
  agent turns the copied lab JSON into `src/config/render.ts` defaults. The app
  never imports `src/lab/`, and the lab stays out of the production build.

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
  true upper bound of `galaxyDensityOf` (a property test pins it). The tier
  comes from the camera's distance to its focus (`cameraDistance`, the one
  conversion from `camera.zoom`; `selectTier`), against thresholds in
  light-years (`*_LY`) that are independent of the sector size and of the
  viewport's aspect ratio. The galaxy / galaxy-field / universe tiers still draw
  a density slice, or a box of space at most one galaxy cell deep
  (`galaxyFieldHalfDepth`, shared by the glow, labels and picking), around the
  focus height (`ctx.camAbsZ`) as billboards, until
  [universe-3d.md](docs/plans/universe-3d.md) B1.4–B1.5 land. The origin rebases
  all three axes together (the 3D local offset), so `controller.focusZ` stays
  small too.
- `TIER_BANDS` lists the cross-fades between neighbouring tiers (`bandBlend`,
  `tierBlends`); each band must enclose its boundary's hysteresis (pinned by
  `tier.test.ts`). Rendering blends system and star layers by `ctx.blend`
  (`tierBlend`, band 0, 0 → 1 across `STAR_BLEND_MIN_AU`–`STAR_BLEND_MAX_AU`);
  the discrete tier still drives selection, HUD and picking. While `blend < 1`
  (`hasSystemLayer`) systems stay streamed, orbiting and origin-anchored even at
  the star tier.
- While the system layer shows, the render origin is the focused star
  (x, y **and** z: `renderOriginZ`), so bodies sit tens of AU out while zoom
  reaches ~150 m/px. `controller.focusZ` is local to `renderOriginZ` (rebased
  with it); the save and bookmarks store absolute z. The Three renderer runs
  with `highPrecision` (float64 CPU model-view) and a reversed float depth
  buffer. Never feed float32 world positions (`positionWorld`,
  `cameraPosition`, raw vertex buffers) into close-up maths: use object-local
  offsets or buffers relative to the focus (see orbit rings, atmosphere, ring
  shadow). Clip labels on view-space depth, not NDC z (reversed depth maps far
  to 0).
- Every shader is TSL and must work on the WebGL2 fallback; WebGPU-only
  features (compute) stay optional enhancements.
- `ColorManagement.enabled = false` globally (`ThreeRenderer`, the lab):
  `Color` values and hex strings are raw sRGB, so colour code must not assume a
  linear working space.
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
  agree on it. The reference plane (`referencePlaneNormal`) is the focused
  disk, slerping across the system ↔ star band to the host galaxy's disk (the
  galaxy at the focus, else the last one, eased on a change of host) and across
  the galaxy-field ↔ universe band to world +z; every swing goes through
  `blendPlaneNormal`, so the camera never snaps or mirrors. Pan, orbit, tilt,
  Flatten and zoom-to-point work the same at every tier.
- A sector holds star-only records (`StarData`: position, name, star physics,
  the system seed). Planets and moons come from `generateSystem(worldSeed,
  star)`, built only for streamed or focused systems through the memoising
  `SectorCache.system`; never read `planets` off a sector record. The bodies
  continue the star's own RNG stream, so they stay identical however often the
  system is regenerated (pinned by `universe.test.ts`).
- Star-tier sector generation is budgeted (`STAR_SECTOR_BUDGET_MS`, via
  `SectorCache.peek`), nearest-first and only for sectors inside the reach
  sphere (`sectorWithinReach`), not the whole cube range; never call `cache.get` for every sector in a star-tier
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
  coordinates (the star tier calls `ensureStarfield`, which fills it once). A
  starfield rebuild samples ~10⁵ galaxy lookups (hundreds of ms) plus a ~30 ms
  sky-structure bake, and the zoomed-out tiers would cross its ~50,000 AU cache
  buckets every frame.
- The starfield band sphere is unrotated: its shader derives the world
  direction from `positionLocal` and must use the same equirectangular
  convention as `sky-structure.ts` (`pixelToDir` / `dirToUv`), or the band and
  the stars disagree.

## Testing responsibilities

**Browser / end-to-end testing is Pierre's job, not the agent's.** The agent
must not start a dev server and drive the running app in a browser to verify
behavior — Pierre does that. After the static checks pass, hand off all
in-browser verification (pan/zoom, LOD tier transitions, persistence, visual
and performance checks) to Pierre.

- The agent **must not** E2E-test the app itself (no Playwright/browser runs,
  no `npm run dev` + screenshot loops).
- The agent **must** still run the full static pipeline before handing off:
  `npm run build` (tsc + vite), `npm test` and `npm run lint`.

## Peer reviews

Keep the mandatory peer-review pass **fast and lightweight**:

- Use a **fast model** for the review subagent.
- Don't over-invest — a single quick structured pass (correctness, types,
  obvious gaps) is enough. Avoid long, exhaustive review loops.
