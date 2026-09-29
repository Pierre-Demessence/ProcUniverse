# Frame Loop on the Engine Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the ~320-line `renderSource.subscribe(...)` callback in `src/main.ts` with named engine `Scheduler` systems driven by a `TickRunner`, with no behaviour change.

**Architecture:** The per-frame state that `main.ts` holds in closure `let`s (render origin, sim clock, current tier, cross-fade timer, scene-cache flag, last-camera snapshot) moves into one `FrameState` object shared by the input handlers and the systems. Each step of today's callback becomes a `SchedulableSystem<FrameCtx>` in `src/frame/`, ordered by `runAfter` and pinned by a test that asserts the full order. Systems that need no canvas (lock, tier, origin rebase, streaming, orbits, pending bookmark) are unit-tested against a real `EcsWorld`; canvas-bound systems (render, reticle, HUD) are moved verbatim.

**Tech Stack:** TypeScript 5.9 strict, Vitest 4 (node), `@pierre/ecs` (`Scheduler`, `TickRunner`, `AnimationFrameTickSource`, `EcsWorld`).

**Spec:** [engine-adoption.md — Scheduler systems for the frame loop](../../research/engine-adoption.md). Builds on [main-ts-split.md](main-ts-split.md), which already extracted `SelectionState`, `ThreeBackend`, and the framing helpers.

## Scope

In scope: the frame loop only.

Not in this plan (each keeps its durable home in [engine-adoption.md](../../research/engine-adoption.md) and [roadmap.md](../../roadmap.md); each gets its own plan when picked up):

- `Scene3DRenderer` for the Three.js system view — belongs with "Split `ThreeRenderer.render()`".
- `Position3DDef` instead of `PositionZDef` — blocked until Canvas 2D is retired.
- Feature-driven adoptions (tween/damp fly-to, noise visuals, `save` module, worker pool, timer) — ride on their roadmap items.

## Global Constraints

- **Behaviour-preserving.** The step order in today's callback encodes past bug fixes and is ported verbatim: lock re-centre → tier → change detection → backend → (dirty only) origin rebase → streaming (+ `endOfTick`) → orbits → pending-bookmark resolve → fade capture → render → Three render → cross-fade → reticle → scene cache → (always) HUD.
- `world.endOfTick()` stays **inside** the streaming system. Orbits read entities the streamer just spawned, so the flush must happen mid-tick; `TickRunner`'s own post-tick flush is an extra no-op.
- Lint sorting is enforced (`perfectionist`): run `npm run lint:fix` after each task.
- `import type` for type-only imports. Tests are `*.test.ts` beside the module; build worlds with a real `EcsWorld` (pattern: `src/pick.test.ts` `makeWorld`).
- No agent browser testing (AGENTS.md). Each task ends with `npm run build`, `npm test`, `npm run lint` green. Browser verification is Pierre's (Task 7).
- Commits only when Pierre asks; each task leaves the tree green.
- `src/frame/` must not import `three` (the Three chunk stays lazy).
- Written comments explain why, not what.

## Review Focus

Behaviour with no unit test (wiring or canvas), verified by Pierre in Task 7:

1. Locked planet stays centred at high time speed; left-drag releases the lock, right-drag does not.
2. Inspecting a bookmark whose system is not yet streamed: camera jumps, then centres on the body's live position and selects it.
3. Zooming across every tier boundary shows the cross-fade (Canvas 2D fallback only) and no blank frame; Three stays continuous.
4. Switching Renderer Three → Canvas 2D → Three mid-session: no blank frames, picking works in both.
5. Reload after moving and orbiting resumes the same view (save on unload still reads camera, orbit, and `simSeconds`).
6. A still camera at a non-system tier in Canvas 2D mode blits the cached scene (frame time drops) and the HUD still updates.

---

## File Structure

- Create `src/frame/frame-state.ts` — `FrameState` class: mutable cross-frame state.
- Create `src/frame/frame-context.ts` — `FrameCtx` (per-tick data) and `FrameDeps` (long-lived collaborators).
- Create `src/frame/systems/*.ts` — one file per system group (see tasks).
- Create `src/frame/pipeline.ts` — `buildFramePipeline(deps)` returns the `Scheduler`.
- Create `src/frame/pipeline.test.ts` — pins system order.
- Modify `src/main.ts` — build deps, replace the subscribe callback with `TickRunner`.

## Task 1: FrameState, FrameCtx, and the order-pinning pipeline

**Files:**
- Create: `src/frame/frame-state.ts`, `src/frame/frame-context.ts`, `src/frame/pipeline.ts`
- Test: `src/frame/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `class FrameState { renderOriginX: number; renderOriginY: number; simSeconds: number; currentTier: Tier; fadeMsLeft: number; sceneCacheValid: boolean; lastCamX: number; lastCamY: number; lastCamZoom: number; lastVpW: number; lastVpH: number; lastSelection: Selection | null; lastDrawnCount: number; lastFlattenVisible: boolean }` — constructor takes `{ simSeconds: number; tier: Tier }`, other fields start at `0` / `false` / `null`.
  - `interface FrameCtx { dtMs: number; tier: Tier; tierChanged: boolean; dirty: boolean; camMoved: boolean; vpChanged: boolean; selChanged: boolean; threeActive: boolean; threeMode: boolean; backendChanged: boolean; camAbsX: number; camAbsY: number; range: SectorRange; focusedSystem: NearestSystem | null; localCam: Camera | null; renderResult: number; renderedByThree: boolean }` plus `function createFrameCtx(dtMs: number, tier: Tier): FrameCtx`.
  - `function buildFramePipeline(systems: readonly SchedulableSystem<FrameCtx>[]): Scheduler<FrameCtx>` — adds all, calls `build()` (throws on cycles / unknown names).

- [x] **Step 1: Write the failing order test**

`src/frame/pipeline.test.ts` starts with a stub-system helper and asserts `scheduler.build().map(s => s.name)` equals the expected list. Use the real names from Tasks 2–6 as stubs so the test pins the final order now:

```ts
import type { SchedulableSystem } from '@pierre/ecs/scheduler';
import type { FrameCtx } from './frame-context';

import { describe, expect, it } from 'vitest';

import { buildFramePipeline } from './pipeline';

const stub = (name: string, runAfter?: string[]): SchedulableSystem<FrameCtx> => ({ name, run: () => {}, runAfter });

const ORDER = [
  'sim-clock', 'lock-recentre', 'tier-select', 'change-detect', 'backend-select',
  'origin-rebase', 'streaming', 'orbits', 'pending-bookmark',
  'fade-capture', 'render-scene', 'render-three', 'cross-fade', 'reticle', 'scene-cache', 'hud',
];

describe('frame pipeline order', () => {
  it('runs steps in the order encoded by past bug fixes', () => {
    const systems = ORDER.map((n, i) => stub(n, i === 0 ? undefined : [ORDER[i - 1]]));
    const built = buildFramePipeline([...systems].reverse()).build();
    expect(built.map(s => s.name)).toEqual(ORDER);
  });
});
```

- [x] **Step 2: Run** `npx vitest run src/frame/pipeline.test.ts` — expect FAIL (module missing).
- [x] **Step 3: Implement** `frame-state.ts`, `frame-context.ts`, and `pipeline.ts` (`new Scheduler<FrameCtx>()`, `for (const s of systems) scheduler.add(s)`, `scheduler.build()`, return scheduler). `ORDER` is exported from `pipeline.ts` as `FRAME_SYSTEM_ORDER` and reused by the test and by each real system's `runAfter` (`runAfter: [prev(name)]` helper `after(name)` in `pipeline.ts`).
- [x] **Step 4: Run** the test — expect PASS.
- [x] **Step 5:** `npm run lint:fix && npm run build && npm test`.

## Task 2: Move cross-frame state into FrameState

Behaviour-neutral prep: `main.ts` reads and writes `state.*` instead of its closure lets, so handlers and (later) systems share one object.

**Files:**
- Modify: `src/main.ts` (lets `renderOriginX`, `renderOriginY`, `simSeconds`, `currentTier`, `fadeMsLeft`, `sceneCacheValid`, `lastCam*`, `lastVp*`, `lastSelection`, `lastDrawnCount`, `lastFlattenVisible`)

**Interfaces:** Consumes `FrameState` from Task 1.

- [x] **Step 1:** Create `const state = new FrameState({ simSeconds: save.simSeconds, tier: selectTier(camera, 'system') })` after `camera` exists. Initialise `lastCam*`/`lastVp*` from the camera exactly as today (`state.lastCamX = camera.x`, …).
- [x] **Step 2:** Replace every use of the listed lets with `state.<field>` (find-and-replace per identifier; `sizeCanvas` sets `state.fadeMsLeft = 0; state.sceneCacheValid = false`; the unload teardown reads `state.simSeconds`, `state.renderOriginX/Y`).
- [x] **Step 3:** `npm run lint:fix && npm run build && npm test` — all green, no behaviour change.

## Task 3: Sim clock, lock, tier, change detection

**Files:**
- Create: `src/frame/systems/view-systems.ts`
- Test: `src/frame/systems/view-systems.test.ts`

**Interfaces:**
- Consumes: `FrameState`, `FrameCtx`, `SelectionState.lockedPosition(world, simSeconds)`, `controller.setFocusZ`, `selectTier(camera, prev)`.
- Produces: `makeSimClockSystem(state, timeControls)`, `makeLockRecentreSystem(deps)`, `makeTierSelectSystem(deps)`, `makeChangeDetectSystem(deps)`, where `deps` is `{ state: FrameState; camera: Camera; selectionState: SelectionState; controller: Pick<CameraController, 'setFocusZ'>; world: EcsWorld }` (each factory takes only the fields it needs).

- [x] **Step 1: Write failing tests.** Cover: (a) sim-clock adds `dtMs / 1000 * timeScale`; (b) lock-recentre with a locked orbiting body sets `camera.x/y` to its position and calls `setFocusZ` with its z, and does nothing when unlocked; (c) tier-select sets `ctx.tier` and `ctx.tierChanged` and updates `state.currentTier` (use a camera whose zoom is inside one tier, then move it across a boundary; read boundaries from `src/lod/tier.ts`); (d) change-detect sets `camMoved` / `vpChanged` / `selChanged` and updates the `last*` snapshot, and it does not compute `dirty` (that needs the backend state, so `backend-select` finalises it in Task 4).
- [x] **Step 2: Run** them — expect FAIL.
- [x] **Step 3: Implement** by moving `main.ts` lines for sim clock (`simSeconds += …`), lock re-centre, `selectTier`, and change detection verbatim into `run(ctx)` bodies. `change-detect` only sets the three flags and snapshots the `last*` values.
- [x] **Step 4:** Run tests — PASS. `npm run lint:fix && npm run build && npm test`.

## Task 4: Backend selection and flatten visibility

**Files:**
- Create: `src/frame/systems/backend-systems.ts`
- Test: `src/frame/systems/backend-systems.test.ts`

**Interfaces:**
- Consumes: `ThreeBackend.update(wantThree)` → `{ threeMode, active, changed }`, `renderBackend.value`, `controller.setThreeSystemActive`, `flattenButton.setVisible`.
- Produces: `makeBackendSelectSystem(deps)` — sets `ctx.threeMode`, `ctx.threeActive`, `ctx.backendChanged`, calls `setThreeSystemActive(active && tier === 'system')`, updates flatten-button visibility via `state.lastFlattenVisible`, then sets `ctx.dirty` with the full formula from `main.ts` line 451.

- [x] **Step 1: Write failing tests** with fake `ThreeBackend`-shaped and `flattenButton` objects: flatten button toggles only on change; `dirty` is true when `threeActive`, when `tier === 'system'`, when `!sceneCacheValid`, and false for a still camera at a non-system tier with a valid cache in Canvas 2D mode.
- [x] **Step 2:** Run — FAIL. **Step 3:** Implement (move `main.ts` lines 419–438 and the `dirty` expression). **Step 4:** PASS. **Step 5:** lint/build/test.

## Task 5: Origin rebase, streaming, orbits, pending bookmark

**Files:**
- Create: `src/frame/systems/world-systems.ts`
- Test: `src/frame/systems/world-systems.test.ts`

**Interfaces:**
- Consumes: `cameraAbsolute`, `rebaseLocal`, `nearestSystem`, `visibleSectors`, `SystemStreamer.update/clear`, `updateOrbits`, `SelectionState.resolvePending`.
- Produces: `makeOriginRebaseSystem`, `makeStreamingSystem`, `makeOrbitsSystem`, `makePendingBookmarkSystem`. `origin-rebase` fills `ctx.camAbsX/Y`, `ctx.range`, `ctx.focusedSystem`. All four return early unless `ctx.dirty`; `orbits` and `pending-bookmark` also require `ctx.tier === 'system'`.

- [x] **Step 1: Write failing tests.** Origin: at `'system'` tier the origin snaps to the focused system's star and `camera.x/y` shift by the same amount so `cameraAbsolute` is unchanged (assert absolute position before == after); at a non-system tier the origin rebases only once `|camera.x| > REBASE_DIST`; `streamer.clear` is called when the origin moves. Streaming: `update` only at system tier, `clear` otherwise, and `world.endOfTick()` is called after either. Pending bookmark: after `resolvePending` returns an id with a position, `camera.x/y` equal that position. Not dirty → no calls.
- [x] **Step 2:** Run — FAIL. **Step 3:** Move `main.ts` lines 454–513 verbatim into the four `run` bodies (the streaming body keeps the `world.endOfTick()` call). **Step 4:** PASS. **Step 5:** lint/build/test.

## Task 6: Render, reticle, cache, HUD (canvas-bound, moved verbatim)

**Files:**
- Create: `src/frame/systems/render-systems.ts`, `src/frame/systems/hud-system.ts`

**Interfaces:**
- Consumes: everything on `FrameCtx` from Tasks 3–5, plus `renderFrame`, `ThreeRenderer` methods, `drawSelectReticle`, `drawBodyLabels3D`, HUD draw helpers, `inspector`, `navTree`, `bookmarkList`, `timeControls`, `frameStats`.
- Produces: `makeFadeCaptureSystem`, `makeRenderSceneSystem` (builds `ctx.localCam`, calls `renderFrame`, sets `ctx.renderResult`), `makeRenderThreeSystem` (per-tier dispatch, sets `ctx.renderedByThree`), `makeCrossFadeSystem`, `makeReticleSystem`, `makeSceneCacheSystem` (dirty: snapshot or invalidate; not dirty and cache valid: blit), `makeHudSystem` (always runs; lines 648–674).

No new unit tests: these touch the 2D context and Three. The order test from Task 1 still guards sequencing, and Pierre verifies visually in Task 7.

- [x] **Step 1:** Move `main.ts` lines 515–522 (fade capture), 524–542 (render scene), 544–578 (Three tiers), 580–587 (cross-fade, incl. `state.fadeMsLeft -= ctx.dtMs`), 589–624 (reticle), 626–646 (draw count + scene cache + blit), 648–674 (HUD) into the seven systems with `state.*` / `ctx.*` in place of locals. `lastDrawnCount` is set in `scene-cache` from `ctx.renderResult`.
- [x] **Step 2:** Add each with `runAfter` per `FRAME_SYSTEM_ORDER`.
- [x] **Step 3:** `npm run lint:fix && npm run build && npm test`.

## Task 7: Wire the TickRunner, docs, handoff

**Files:**
- Modify: `src/main.ts` (delete the `subscribe` callback), `docs/codebase.md`, `docs/agent/README.md`, `docs/research/engine-adoption.md`, `docs/roadmap.md`

- [x] **Step 1:** In `main.ts`, build `const systems = [...]` from Tasks 3–6, `const scheduler = buildFramePipeline(systems)`, then:

```ts
const runner = new TickRunner<FrameCtx>({
  contextFactory: info => createFrameCtx(info.deltaMs ?? 0, state.currentTier),
  getWorld: () => world,
  scheduler,
  source: new AnimationFrameTickSource(),
});
runner.start();
```

Teardown calls `runner.stop()` instead of `renderSource.stop(); unsubscribe()`. `frameStats.sample(dt)` moves into the `sim-clock` system (first system, as today).
- [x] **Step 2:** Confirm `main.ts` is under ~450 lines and contains no per-frame logic.
- [x] **Step 3:** Docs: `docs/codebase.md` (add `src/frame/`, describe the pipeline and where to add a new step), `docs/agent/README.md` (invariant: order is pinned by `pipeline.test.ts`; `endOfTick` lives in `streaming`), `docs/research/engine-adoption.md` (Scheduler is adopted; remove it from "Structural opportunities" and from "Current usage" prose), `docs/roadmap.md` (remove nothing that shipped; keep the `ThreeRenderer` split item; add a line to "Engineering health" for `Scene3DRenderer` adoption pointing at engine-adoption.md).
- [x] **Step 4:** Tick all boxes in this plan, move it to `docs/plans/done/frame-scheduler.md` with the final commit.
- [x] **Step 5:** Peer review (fast model, one structured pass, reviewer told not to edit code or use questions) on correctness, types, ordering, docs gaps. Fix findings.
- [x] **Step 6:** Full pipeline: `npm run lint:fix && npm run build && npm test`. Hand the Review Focus list to Pierre for browser verification.
