# Retire the Canvas 2D renderer

Three.js draws every tier and is the only renderer. The Canvas 2D *backend*
(the engine `Canvas2DRenderer` plus the per-tier `draw-*` modules) is removed.
The transparent 2D **overlay** canvas stays: it carries body and galaxy labels,
the selection reticle, the stats panel, hint line, scale bar and coordinates.

Removing the backend unblocks the component migration listed in
[engine-adoption.md](../../research/engine-adoption.md): bodies move to the
engine's `Position3DDef`, and the 3D path stops borrowing the 2D renderer's
`RenderableDef`.

## Decisions

- **3D cannot start** (Three chunk fails to load or the renderer fails to
  initialise): show a centred DOM notice that ProcUniverse needs WebGPU or
  WebGL, and log the error. No 2D fallback.
- **Three stays lazy-loaded** (`import()` in `main.ts`): the page shell and HUD
  appear immediately; the scene appears once the renderer is ready.
- **No dirty-frame tracking.** Three redraws every frame, so the dirty flag,
  the scene snapshot cache and the tier cross-fade (all 2D-only
  optimisations) go.
- The stored `renderBackend` preference is dropped; an old stored value is
  ignored.

## Phase 1 — remove the Canvas 2D backend

- [x] `ThreeBackend`: always load; drop the `wanted` argument and `threeMode`;
      expose `failed` so `main.ts` can show the failure notice once.
- [x] `src/ui/render-failure.ts`: the failure notice.
- [x] Frame pipeline: remove `fade-capture`, `render-scene`, `cross-fade`,
      `scene-cache` and `change-detect` if nothing else consumes it; add an
      overlay clear at the top of the render step; `render-three` applies
      `applyBodyScale` and records the drawn count.
- [x] `FrameCtx` / `FrameState`: drop `dirty`, `threeMode`, `renderedByThree`,
      `backendChanged`, `fadeMsLeft`, `sceneCacheValid` and the change-detect
      fields that become unused.
- [x] Delete `render/scene.ts`, `draw-stars.ts`, `draw-galaxy.ts`,
      `draw-universe.ts`, `grid.ts` (+ test), the sprite pass of
      `draw-galaxy-field.ts` (its labels move to `draw-labels.ts`), the 2D
      `drawBodyLabels`, `drawOrbitRings`, and `pickBodyAt` (+ tests).
- [x] `main.ts`: drop `Canvas2DRenderer`, fade / scene-cache canvases, and the
      2D pick branch.
- [x] Reticle: drop the 2D projection branch. HUD hint: renderer label from
      Three only.
- [x] `settings.ts`: remove `renderBackend` / `setRenderBackend`;
      `config/render.ts`: remove `TIER_FADE_MS` and other 2D-only constants.
- [x] Rewrite code comments that say "mirrors `drawX`" to stand alone.

## Phase 2 — component migration

- [x] `BodyVisualDef` (project component, `{ color, radius }`): the drawn colour
      and zoom-floored radius the 3D passes, labels, reticle and picking read.
      Replaces `RenderableDef` (its stroke / line width were 2D-only).
- [x] Bodies carry the engine `Position3DDef` (`{x, y, z}`) instead of
      `PositionDef` + `PositionZDef`; stars and black holes get `z = 0`.
- [x] Update spawn, orbits, body passes, labels, framing, selection, bookmarks,
      the world plugin and all tests.

## Phase 3 — scheduler run conditions

- [x] Whole-system gates (`tier === 'system'`, Three active) move from
      early returns into the engine scheduler's `runIf`; gates that depend on
      values computed inside the system stay in `run`.
- [x] Tests assert the `runIf` predicate instead of calling `run` on a gated
      context.

## Docs

- [x] `roadmap.md`: drop "Retire the Canvas 2D renderer"; Direction bullet says
      Three is the only renderer.
- [x] `research/engine-adoption.md`: move `Position3DDef` and run conditions
      to current usage.
- [x] `features.md`, `codebase.md`, `tech-stack.md`, `agent/README.md`,
      `plans/rendering-backend.md`: remove Canvas 2D backend references.

## Verification

- [x] `npm run lint`, `npm run build`, `npm test` pass. The engine's cached
      query handles made `Scene3DRenderer` call `select` once and re-iterate
      it, which emptied the one-shot body generators after the first frame;
      `makePass` now wraps them in a re-iterable.
- [x] Peer review (fast model).
- [x] Hand off to Pierre for in-browser checks: every tier renders, labels /
      reticle / picking / bookmarks / lock work, the failure notice shows when
      the Three chunk is blocked.
