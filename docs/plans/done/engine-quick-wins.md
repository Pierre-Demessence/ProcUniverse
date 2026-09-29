# Engine Quick Wins

**Goal:** Replace two hand-rolled pieces with existing `@pierre/ecs` features,
without changing behaviour.

1. **Pointer projection.** `toBacking` in `src/camera/camera-controller.ts` and
   `toBackingPx` in `src/main.ts` duplicate the engine's `projectPointer`
   (`@pierre/ecs/modules/input`): client coordinates → canvas backing pixels.
   The engine version also guards a zero-size rect (returns CSS pixels instead
   of `NaN`/`Infinity`).
2. **World plugin.** The component registrations at the top of `start()` move
   into a `universePlugin` (`src/world-plugin.ts`) installed with
   `world.use(universePlugin)`, so the app and tests build the same world in
   one call.

**Not done:** entity templates for `spawnSector`. Every component value there
is per-body data, so a template would carry nothing and all data would move
into string-keyed, untyped overrides — a type-safety loss with no gain.

## Tasks

- [x] Replace `toBacking` / `toBackingPx` with `projectPointer`.
- [x] Add `src/world-plugin.ts` with `universePlugin`; use it in `main.ts`.
- [x] Unit test: the plugin registers every component the app uses.
- [x] Update `docs/codebase.md`.
- [x] `npm run build`, `npm test`, `npm run lint` green.
- [x] Peer review.
