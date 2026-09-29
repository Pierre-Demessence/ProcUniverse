# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; loads or mints the universe save, then calls `start(root, save)`. |
| `src/main.ts` | Entry: canvas and DPR sizing, ECS world, input handlers, and the wiring that builds the frame pipeline and starts its `TickRunner`. |
| `src/frame/` | The per-frame loop as engine `Scheduler` systems. `frame-state.ts` (`FrameState`) holds cross-frame state shared with the input handlers; `frame-context.ts` (`FrameCtx`) carries per-tick values between systems; `pipeline.ts` declares the step order (`FRAME_SYSTEM_ORDER`); `systems/` holds the steps: view (clock, lock, tier, change detection), backend, world (origin rebase, streaming, orbits, pending bookmark), render (fade, scene, Three, reticle, scene cache), and HUD. |
| `src/selection-state.ts` | Selection, camera lock, and pending-bookmark state (`SelectionState`): one place for the rules that tie them together. |
| `src/config/` | Central tuning knobs: `data.ts` for generation (density, orbit architecture, physics parameters) and `render.ts` for camera/zoom, LOD tiers, visual sizing, and simulation time. |
| `src/settings.ts` | User display settings as `@preact/signals` (units, naming style, body scale, renderer), persisted via `persistence/preferences.ts`. |
| `src/scale.ts` | Spatial-scale source of truth: the AU world unit, light-years per sector, and the star visual-radius mapping. |
| `src/bookmarks.ts` | Bookmark types and helpers: `Bookmark` identity, `bookmarkKey`, `isBookmarked`, and `selectionBookmarkKey`, plus creation (`bookmarkFromSelection`), toggle, and removal. |
| `src/world-plugin.ts` | `universePlugin`: the engine plugin that registers every component a streamed body carries; `main.ts` installs it with `world.use`. |
| `src/pick.ts` | Cursor-to-body picking: the nearest star or planet within the click tolerance, plus a by-name entity lookup for the location tree. |
| `src/generation/` | Deterministic seed-driven sector generation (pure data — a galaxy field of many galaxies with central black holes that places and colours stars, plus stellar, orbital, and planetary physics) and entity spawning. |
| `src/lod/` | LOD tier selection, the generate-on-demand sector cache, and system-tier streaming, and `nearestSystem`. |
| `src/sim/` | Keplerian orbital-elements component, per-frame elliptical orbit update, and orbit-ring drawing. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera, and framing (`selectionFrame`, `frameSelection`, the locked body's live position). |
| `src/render/three/` | The primary Three.js renderer (`three/webgpu`, lazy-loaded): every tier, the 3D system view (spheres, star shading, rings, starfield dome, bloom), picking, and projection for labels. |
| `src/render/` | Canvas 2D (frozen fallback) per-tier frame composition and the 2D HUD overlay drawn on top of either renderer: reference grid, orbit rings, star dots, galaxy-density glow, galaxy-field sprites / labels, the cosmic-web universe glow, body name labels, the HUD scale bar + coordinate readout, and the selection reticle. `three-backend.ts` (`ThreeBackend`) owns the lazy Three load, activation, and Canvas 2D fallback. |
| `src/ui/` | HUD overlays above the canvas: the simulation clock / time-scale slider, the body-inspector panel, the top-left location tree, the bookmark list panel, the options menu, `nav-state.ts` (location-tree state), and the "Return to origin" / "Flatten" buttons (Preact + signals). |
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

- New visuals → `src/render/three/` only; Canvas 2D is a frozen fallback.
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
