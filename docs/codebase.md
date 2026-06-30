# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; loads or mints the universe save, then calls `start(root, save)`. |
| `src/main.ts` | Entry: canvas, DPR/resize, ECS world, the LOD render loop, and the HUD. |
| `src/config.ts` | Central tuning knobs in one place: density, camera/zoom, LOD tiers, orbit architecture, visual-disc sizing, and simulation time. |
| `src/scale.ts` | Spatial-scale source of truth: the AU world unit, light-years per sector, and the star visual-radius mapping. |
| `src/pick.ts` | Cursor-to-body picking: the nearest star or planet within the click tolerance, plus a by-name entity lookup for the location tree. |
| `src/generation/` | Deterministic seed-driven sector generation (pure data — a galaxy field of many galaxies with central black holes that places and colours stars, plus stellar, orbital, and planetary physics) and entity spawning. |
| `src/lod/` | LOD tier selection, the generate-on-demand sector cache, and system-tier streaming. |
| `src/sim/` | Keplerian orbital-elements component, per-frame elliptical orbit update, and orbit-ring drawing. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera. |
| `src/render/` | Per-tier frame composition: reference grid, orbit rings, star dots, galaxy-density glow, galaxy-field sprites / labels, the cosmic-web universe glow, body name labels, the HUD scale bar + coordinate readout, and the selection reticle. |
| `src/ui/` | HUD overlays above the canvas: the simulation clock / time-scale slider, the body-inspector panel, and the top-left location tree (Preact + signals), plus the "Return to origin" button. |
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
