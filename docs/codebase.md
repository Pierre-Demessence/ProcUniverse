# Codebase Map

| Path | Purpose |
| ---- | ------- |
| `index.html` | Mounts the app; calls `start()` from `src/main.ts`. |
| `src/main.ts` | Entry: canvas, DPR/resize, ECS world, rAF loop, FPS HUD. |
| `src/camera/` | Free-floating pan/zoom controller over the engine camera. |
| `src/render/` | Per-frame scene composition and the reference grid. |
| `docs/` | Project documentation and plans. |

## Conventions

- TypeScript with ES modules and `verbatimModuleSyntax` — use `import type`
  for type-only imports.
- Prefer engine modules over hand-rolled helpers. Check the engine API surface
  first: `../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`.
- All camera and pointer math runs in canvas backing pixels; keep
  `camera.viewportW/H` equal to `canvas.width/height`.

## Where to add new code

- Deterministic generators → `src/generation/` (Phase 1+).
- LOD tier selection and streaming → `src/lod/` (Phase 2+).
- Orbit and other simulation systems → `src/sim/` (Phase 1+).
- Persistence (seed + player deltas) → `src/persistence/` (Phase 4).
