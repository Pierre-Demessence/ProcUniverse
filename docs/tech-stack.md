# Tech Stack

| Area | Choice | Minimum |
| ---- | ------ | ------- |
| Language | TypeScript | 5.9 |
| Build / dev server | Vite | 8 |
| Runtime | Evergreen browsers with Canvas 2D | current |
| Engine | `@pierre/ecs` (sibling `file:` dependency) | 0.0.0 |
| Package manager | npm | 10 |

## Notes

- Rendering starts on Canvas 2D via the engine's `Canvas2DRenderer`, kept
  behind the engine `Renderer<TCtx>` interface so a WebGL / PIXI backend can be
  added for the dense zoom tiers without touching generation or simulation.
- No test runner is wired yet; it is added when the first deterministic
  generator lands (Phase 1), so determinism can be asserted.
