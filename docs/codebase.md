# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; loads/mints the world seed, then calls `start(root, seed)`. |
| `src/main.ts` | Entry: canvas, DPR/resize, ECS world, the LOD render loop, and the HUD. |
| `src/generation/` | Deterministic seed-driven sector generation (pure data — including stellar and orbital physics) plus entity spawning. |
| `src/lod/` | LOD tier selection, the generate-on-demand sector cache, and system-tier streaming. |
| `src/sim/` | Keplerian orbital-elements component, per-frame elliptical orbit update, and orbit-ring drawing. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera. |
| `src/render/` | Per-tier frame composition: reference grid, orbit rings, star dots, galaxy glow. |
| `src/persistence/` | World-seed persistence via the engine `save` module (random on first run; cleared storage = new universe). |
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
- Persistence (seed + player deltas) → `src/persistence/` (`seed.ts` persists
  the world seed today; player deltas and naming are deferred).
