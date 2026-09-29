# Tech Stack

| Area | Choice | Minimum |
| ---- | ------ | ------- |
| Language | TypeScript | 5.9 |
| Build / dev server | Vite | 8 |
| Test runner | Vitest | 4 |
| HUD overlays | Preact + `@preact/signals` | 10 / 2 |
| Runtime | Evergreen browsers with Canvas 2D | current |
| Engine | `@pierre/ecs` (sibling `file:` dependency; CI pins a commit) | 0.0.0 |
| 3D / GPU backend (optional) | Three.js `three/webgpu` (WebGPU + WebGL2 fallback) | 0.184 |
| Package manager | npm | 10 |

## Notes

- Locally, `@pierre/ecs` resolves to whatever is checked out in the sibling
  engine folder. CI and the itch.io publish check out the engine at the commit
  pinned in [`.github/actions/setup/action.yml`](../.github/actions/setup/action.yml),
  so engine changes only reach CI when that ref is bumped.
- CI (lint, test, build) runs on pushes and PRs to `main`; the itch.io publish
  runs only after CI succeeds for a push to `main`.
- Rendering starts on Canvas 2D via the engine's `Canvas2DRenderer`, kept
  behind the engine `Renderer<TCtx>` interface. An optional **Three.js** backend
  (`three/webgpu` — WebGPU with automatic WebGL2 fallback) is being added behind a
  runtime **Renderer** toggle (default Canvas 2D); Stage 0 draws the system tier
  through it and lazy-loads the three bundle so Canvas 2D sessions never download
  it. See [plans/rendering-backend.md](plans/rendering-backend.md).
- The DOM HUD overlays are Preact components (JSX via `@preact/preset-vite`,
  `jsxImportSource: preact`); the canvas / ECS render loop stays imperative.
  Per-frame values (the sim date) flow through `@preact/signals` so only the
  affected text node updates, never the whole component.
- Vitest is wired for unit tests (e.g. the sector-generation determinism
  test). Run the suite with `npm test`.
