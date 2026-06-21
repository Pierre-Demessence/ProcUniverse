# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; calls `start()` from `src/main.ts`. |
| `src/main.ts` | Entry: canvas, DPR/resize, ECS world, generation, the rAF loop with orbit updates, and the FPS HUD. |
| `src/generation/` | Deterministic seed-driven sector generation (pure data) plus entity spawning. |
| `src/sim/` | Analytic orbit component, per-frame orbit update, and orbit-ring drawing. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera. |
| `src/render/` | Per-frame scene composition, reference grid, and orbit rings. |
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
- LOD tier selection and streaming → `src/lod/` (Phase 2+).
- Simulation systems → `src/sim/` (alongside the orbit system).
- Persistence (seed + player deltas) → `src/persistence/` (Phase 4).
