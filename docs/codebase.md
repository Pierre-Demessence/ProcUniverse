# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; loads or mints the universe save, then calls `start(root, save)`. |
| `lab.html` | Dev-only planet lab page (served by `npm run dev` at `/lab.html`, not part of the production build); loads `src/lab/planet-lab.ts`. |
| `src/main.ts` | Entry: canvas and DPR sizing, ECS world, input handlers, and the wiring that builds the frame pipeline and starts its `TickRunner`. |
| `src/frame/` | The per-frame loop as engine `Scheduler` systems. `frame-state.ts` (`FrameState`) holds cross-frame state shared with the input handlers; `frame-context.ts` (`FrameCtx`) carries per-tick values between systems; `pipeline.ts` declares the step order (`FRAME_SYSTEM_ORDER`); `systems/` holds the steps: view (clock, lock, tier), backend, world (origin rebase, streaming, orbits, pending bookmark), render (overlay clear, Three, reticle), and HUD. Steps that only apply in some frames declare it with the scheduler's `runIf`. |
| `src/selection-state.ts` | Selection, camera lock, and pending-bookmark state (`SelectionState`): one place for the rules that tie them together. |
| `src/config/` | Central tuning knobs: `data.ts` for generation (density, orbit architecture, physics parameters) and `render.ts` for camera/zoom, LOD tiers, visual sizing, and simulation time. |
| `src/settings.ts` | User display settings as `@preact/signals` (units, naming style, body scale), persisted via `persistence/preferences.ts`. |
| `src/scale.ts` | Spatial-scale source of truth: the AU world unit, light-years per sector, and the star visual-radius mapping. |
| `src/bookmarks.ts` | Bookmark types and helpers: `Bookmark` identity, `bookmarkKey`, `isBookmarked`, and `selectionBookmarkKey`, plus creation (`bookmarkFromSelection`), toggle, and removal. |
| `src/world-plugin.ts` | `universePlugin`: the engine plugin that registers every component a streamed body carries; `main.ts` installs it with `world.use`. |
| `src/pick.ts` | Selection types, galaxy picking at the galaxy-field tier, and a by-name entity lookup for the location tree. System-tier body picking is `ThreeRenderer.pickAt`. |
| `src/generation/` | Deterministic seed-driven sector generation (pure data — a galaxy field of many galaxies with central black holes that places and colours stars, plus stellar, orbital, and planetary physics) and entity spawning. `body-visual.ts` (`BodyVisualDef`) is the drawn colour and radius of a streamed body; bodies are positioned with the engine `Position3DDef`. |
| `src/lod/` | LOD tier selection, the generate-on-demand sector cache, and system-tier streaming, and `nearestSystem`. |
| `src/sim/` | Keplerian orbital-elements component, per-frame elliptical orbit update, and orbit-ring tessellation. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera, and framing (`selectionFrame`, `frameSelection`, the locked body's live position). |
| `src/render/three/` | The Three.js renderer (`three/webgpu`, lazy-loaded): every tier, the 3D system view (spheres, star shading, rings, starfield dome, bloom), picking, and projection for labels. Planet spheres use the shared lit `planet-material.ts` (flat fill, or a procedural surface baked once via `surface-bake.ts` or evaluated per pixel); `rocky-surface.ts` is the rocky / super-Earth surface (terrain, craters, oceans, ice caps, lava) baked with relief; `atmosphere-material.ts` draws the additive rim-glow shell around planets that keep an atmosphere; `planet-surface.ts` holds the pure, tested helpers (variety seed, UV mapping, atmosphere family and column, rocky regime). `body-passes.ts` (`BodyPasses`) manages the system-tier body meshes as engine `Scene3DRenderer` passes; `recycle-pool.ts` (`RecyclePool`) recycles the meshes and materials they hand back. |
| `src/lab/` | The dev-only planet lab: one large lit planet with `lil-gui` sliders driving the same planet material, a real-planet picker (`lab-planets.ts`), a size preview (`lab-view.ts`), and a test surface (`probe-surface.ts`). Never imported by the app. |
| `src/render/` | The transparent 2D overlay drawn over the Three canvas: body and galaxy name labels, the HUD scale bar + coordinate readout, and the selection reticle; plus shared helpers (`body-scale.ts` zoom-floored body radii, `galaxy-sprites.ts` population colours). `three-backend.ts` (`ThreeBackend`) owns the lazy Three load, activation, and failure reporting. |
| `src/ui/` | HUD overlays above the canvas: the simulation clock / time-scale slider, the body-inspector panel, the top-left location tree, the bookmark list panel, the options menu, `nav-state.ts` (location-tree state), and the "Return to origin" / "Flatten" buttons (Preact + signals), and the notice shown when 3D cannot start (`render-failure.ts`). |
| `src/persistence/` | Persistence: `save.ts` stores the universe save (seed + camera view + sim clock/speed); `preferences.ts` stores display settings (temperature unit) that outlive a seed reset. |
| `docs/` | Project documentation and plans. |

## Conventions

- TypeScript with ES modules and `verbatimModuleSyntax` — use `import type`
  for type-only imports.
- Prefer engine modules over hand-rolled helpers. Check the engine API surface
  first: `../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`.
- All camera and pointer math runs in canvas backing pixels; keep
  `camera.viewportW/H` equal to `canvas.width/height`.

## Where to add new code

- New visuals → `src/render/three/`; screen-space text and markers → the overlay in `src/render/`.
- New per-frame step → a `SchedulableSystem<FrameCtx>` in `src/frame/systems/`, its name added to `FRAME_SYSTEM_ORDER` in `src/frame/pipeline.ts` and to the order asserted in `pipeline.test.ts`.
- New per-tier generators → `src/generation/` (the deterministic, pure-data
  layer; keep DOM/ECS side effects in the spawn step).
- LOD tiers, streaming, and the sector cache → `src/lod/`.
- Simulation systems → `src/sim/` (alongside the orbit system).
- DOM UI overlays (readouts, controls) → `src/ui/` as Preact components
  (`.tsx`). Keep the canvas / ECS loop imperative; expose an imperative handle
  (`createX(container) → { update, dispose }`) and push per-frame values through
  `@preact/signals` so only the bound text node updates.
- Persistence → `src/persistence/`: `save.ts` for seed-bound state (the universe
  save — seed, camera view, sim clock/speed) and `preferences.ts` for settings
  that survive a seed reset. Body naming is a pure seed function in
  `src/generation/naming.ts`, so it needs no persistence.
