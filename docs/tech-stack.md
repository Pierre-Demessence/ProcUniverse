# Tech Stack

| Area | Choice | Minimum |
| ---- | ------ | ------- |
| Language | TypeScript | 5.9 |
| Build / dev server | Vite | 8 |
| Test runner | Vitest | 4 |
| HUD overlays | Preact + `@preact/signals` | 10 / 2 |
| Runtime | Evergreen browsers with WebGPU or WebGL2 (Canvas 2D fallback) | current |
| Engine | `@pierre/ecs` (sibling `file:` dependency; CI pins a commit) | 0.0.0 |
| Renderer | Three.js `three/webgpu` (WebGPU + WebGL2 fallback) | 0.184 |
| Package manager | npm | 10 |
| Dev tuning panel (planet lab only) | `lil-gui` (devDependency) | 0.21 |

## Notes

- Locally, `@pierre/ecs` resolves to whatever is checked out in the sibling
  engine folder. CI and the itch.io publish check out the engine at the commit
  pinned in [`.github/actions/setup/action.yml`](../.github/actions/setup/action.yml),
  so engine changes only reach CI when that ref is bumped.
- CI (lint, test, build) runs on pushes and PRs to `main`; the itch.io publish
  runs only after CI succeeds for a push to `main`.
- Three.js (`three/webgpu`, WebGPU with automatic WebGL2 fallback) is the
  default renderer for every tier, lazy-loaded as a separate chunk. The engine's
  `Canvas2DRenderer` path is a frozen fallback, used when Three cannot load or
  initialise, or when chosen in Options. See
  [plans/rendering-backend.md](plans/rendering-backend.md).
- The DOM HUD overlays are Preact components (JSX via `@preact/preset-vite`,
  `jsxImportSource: preact`); the canvas / ECS render loop stays imperative.
  Per-frame values (the sim date) flow through `@preact/signals` so only the
  affected text node updates, never the whole component.
- Vitest runs the unit tests (`*.test.ts` next to their modules) with
  `npm test`; ESLint uses `@antfu/eslint-config`.
