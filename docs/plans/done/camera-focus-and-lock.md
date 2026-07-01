# Camera focus & lock (inspector actions)

Two new inspector actions on a selected celestial body:

1. **Zoom / Fly to** — pan + zoom the camera to frame the body. Works for
   galaxies, stars, planets, moons, and black holes.
2. **Lock** — hold the body at the centre of the view every frame (you can still
   zoom in/out; the body stays centred), auto-releasing the moment you pan. Only
   offered for bodies that actually *move* — planets and moons.

Both are small, self-contained camera behaviours: no universe-generation changes,
so determinism is untouched.

## Design decisions (answers to the open questions)

### The one framing rule

> **Zoom-to frames the selected body together with whatever orbits it.**

| Selection | Framed extent | Fallback when it has no satellites |
|---|---|---|
| **Star** | outermost planet's apoapsis (`a·(1+e)`) | a few star-disc radii |
| **Planet** | outermost **moon's** apoapsis | a few planet-disc radii |
| **Moon** | — | a few moon-disc radii |
| **Black hole** | — | a few Schwarzschild radii (its drawn disc) |
| **Galaxy** | the galaxy disc (`radius · GALAXY_SPRITE_SCALE`) | — |

This directly adopts Pierre's instinct ("just far enough so the outermost orbit
is visible") for stars, and extends it consistently one level down for planets
(their outermost **moon** orbit — *not* the planet's own orbit around the star,
which would merely re-frame the whole system and duplicate the star action). It
also makes the planet framing exactly the view the Lock use-case wants: close
enough to watch the moons orbit.

Moons, black holes, and galaxies have nothing meaningful orbiting them at this
level, so they frame their own disc at a comfortable size. Every framed extent is
`max(satelliteExtent, discRadius · DISC_FRAME_FACTOR)` so we never zoom in tighter
than the body itself even when a satellite orbit is tiny.

### Which bodies get which button

| Panel | Zoom to | Lock |
|---|---|---|
| Star | ✅ | — |
| Planet | ✅ | ✅ |
| Moon | ✅ | ✅ |
| Black hole | ✅ | — |
| Galaxy | ✅ | — |
| Universe | — (the "Return to origin" button already does this) | — |

**Lock is only for planets and moons** — the bodies that move. Stars sit at their
system's fixed centre, and galaxies / black holes are static, so locking them is a
no-op (you can already pan to them and they stay put). This is exactly Pierre's
call ("doesn't make sense to lock galaxies/stars since they don't move").

### Lock while far away → centre + lock, keep the zoom

Engaging Lock **centres the body and holds it, at the current zoom** — it does
*not* auto-zoom. If you lock while zoomed out, the (tiny) body snaps to the centre
and stays there; you then scroll in and, because it's locked, you dive straight
toward it with it pinned dead-centre. Keeping Lock and Zoom-to as **separate,
composable** actions is the most predictable design:

- Want framing *and* pinning? Click **Zoom to**, then **Lock** (or vice-versa —
  they agree, both centre the same body).
- Lock never surprises you with a zoom change; Zoom-to never pins.

(An optional "Lock also frames on engage" behaviour is noted under Open questions
if Pierre prefers one click.)

## Architecture this builds on (verified)

- **Camera is absolute.** `controller.camera.{x,y}` are world AU (the view
  centre), `zoom` is px/AU, clamped to `[MIN_ZOOM, MAX_ZOOM]`. It's a plain engine
  `Camera` object — `src/camera/camera-controller.ts` only attaches pan/zoom
  handlers, so external code may write `camera.x/y/zoom` directly. Framing a body
  is just: set `camera.x/y` to its absolute position and `camera.zoom` to the fit
  zoom.
- **Floating render origin.** Streamed entities' `PositionDef` are in the
  `renderOriginX/Y` frame; **absolute = `pos + renderOrigin`**. Galaxies store
  absolute `centerX/centerY` already (`src/pick.ts` does the same conversion for
  picking).
- **Pure orbit solver.** `writeOrbitPosition(orbit, tYears, out)` in
  `src/sim/orbits.ts` is exported and analytic — a body's position at any
  `simSeconds` is a closed-form function of its orbit, **independent of the camera
  or streaming**. This is what lets Lock stay glued to a planet even at high time
  scale (no one-frame lag).
- **Selection lifecycle.** `Selection` (`src/pick.ts`) is a body / galaxy /
  universe union. Body selections only exist at the **system tier** (the tree
  hides body nodes otherwise, and `src/main.ts` clears a body selection when it
  streams out) → whenever a Zoom-to/Lock button is visible for a body, its entity
  is guaranteed to exist.
- **Inspector is a Preact island.** `createInspector(container)` renders panels
  from a per-frame `update(world, selection)`; the render loop pushes a stable
  selection reference so panels only re-render on change. Buttons + a lock-state
  signal slot cleanly into this.
- **Reset-view button** (`src/ui/reset-view.ts`) is the template for a plain DOM
  control that calls back into `main.ts` to move the camera.

## Feature A — Zoom / Fly to

### Target computation (in `main.ts`, from the current `selection`)

The inspector button fires a parameterless `onZoomTo()`; `main.ts` reads its own
`selection` (it is the source of truth) and computes `{x, y, zoom}`:

- **Centre `(x, y)`** — absolute position:
  - galaxy → `selection.galaxy.centerX/centerY`.
  - star/planet/moon/black-hole → `positions.get(id) + (renderOriginX, renderOriginY)`.
- **Extent (AU)** — the framed radius, per the table above:
  - **star**: scan planet orbits sharing the star's focus
    (`OrbitElementsDef` with `parent < 0` and `cx/cy ≈ starPos`), take
    `max(a·(1+e))`; fall back to `starVisualRadius(R☉) · DISC_FRAME_FACTOR`.
  - **planet**: scan `OrbitElementsDef` with `parent === planetId`, take
    `max(a·(1+e))`; fall back to `planetVisualRadius(R⊕) · DISC_FRAME_FACTOR`.
  - **moon / black-hole / galaxy**: `discRadius · DISC_FRAME_FACTOR`
    (galaxy uses `radius · GALAXY_SPRITE_SCALE`).
  - Always `extent = max(satelliteExtent, discRadius · DISC_FRAME_FACTOR)`.
- **Zoom** — pure, testable:

  ```text
  frameZoom(extentAu, vpW, vpH, margin) =
    clamp( min(vpW, vpH) / (2 · extentAu · margin), MIN_ZOOM, MAX_ZOOM )
  ```

  `min` of the two viewport axes guarantees the extent fits in both dimensions;
  `margin` (≈1.4) leaves breathing room. A tiny moon may clamp at `MAX_ZOOM`
  (can't fill the screen) — acceptable.

Framing a star's outermost orbit lands a zoom that stays inside the system tier
(the outermost orbit ≤ ~150 AU, diameter ≤ 300 AU = `SYSTEM_TIER_MAX_AU`), so the
system stays streamed. Galaxy framing lands in the galaxy / galaxy-field tiers via
the normal `selectTier` path — no special-casing needed.

### Applying it

- **Phase A (ship first): instant.** Set `camera.x/y/zoom` directly. Done.
- **Phase B (bonus, deferred): smooth fly.** Store a
  `flyAnim = { fromX, fromY, fromZoom, toX, toY, toZoom, elapsedMs, durationMs }`;
  each frame (before `selectTier`) advance it, easing position linearly and zoom
  **geometrically** (`from · (to/from)^e`, natural for a multiplicative scale)
  with a smoothstep `e`. Any wheel/drag input cancels it. The instant path is just
  the `durationMs → 0` case, so Phase B flips one branch.

### New pure helpers — `src/camera/focus.ts` (+ `focus.test.ts`)

- `frameZoom(extentAu, vpW, vpH, margin)` — the clamped-fit formula.
- `maxApoapsis(orbits: OrbitElements[])` — `max(a·(1+e))` or `0` for an empty list.
- (Phase B) `easeInOut(t)` and `lerpZoom(from, to, t)`.

Entity/cache/galaxy glue stays in `main.ts` (it needs the `world`); only the math
is factored out so it can be unit-tested under Node, matching the repo's
pure-function testing convention.

## Feature B — Lock

State in `main.ts`: `let lockedId: EntityId | null = null` (only ever a planet or
moon).

### Holding the body centred (the core)

At the **top of the rAF callback, before `selectTier`** (so the whole frame —
tier, origin, streaming, render — is consistent with the body centred):

```text
if (lockedId !== null) {
  const p = lockedBodyAbsPos(world, lockedId, renderOriginX, renderOriginY, simSeconds)
  if (p) { camera.x = p.x; camera.y = p.y }   // keep camera.zoom as-is
  else    lockedId = null                      // entity streamed out → release
}
```

`lockedBodyAbsPos` re-derives the body's position **this frame** from the pure
solver (no lag at high time scale — the key requirement):

```text
orbit = OrbitElementsDef.get(id); if (!orbit) return null
years = simSeconds / SECONDS_PER_YEAR
if (orbit.parent < 0)                      // planet: focus cx/cy = star (render frame)
   writeOrbitPosition(orbit, years, tmp)
else                                       // moon: solve its planet first, two-level
   parent = OrbitElementsDef.get(orbit.parent); if (!parent) return null
   writeOrbitPosition(parent, years, planetPos)
   writeOrbitPosition({ ...orbit, cx: planetPos.x, cy: planetPos.y }, years, tmp)
return { x: tmp.x + renderOriginX, y: tmp.y + renderOriginY }
```

This mirrors the two-pass logic in `updateOrbits`. Because the host star is
static, last frame's `renderOrigin` is still the correct star-local origin, so
`tmp + renderOrigin` is exact.

### Interaction with zoom (why it "just works")

The wheel handler in the controller pins the world point under the cursor
(changing `zoom` **and** `x/y`). While locked, the next frame's re-centre discards
that `x/y` shift and restores the body to centre — net effect: **zoom changes,
the body stays centred** (zoom effectively pivots around the body instead of the
cursor). Exactly the locked behaviour we want; no controller changes needed.

### Releasing the lock

`lockedId` is set **only** by the Lock button. It is cleared when:

- **You pan.** A canvas pointer-drag beyond `CLICK_SLOP_PX` releases it (a new
  window `pointermove` handler, gated by a canvas-scoped drag flag). Wheel zoom
  does **not** drag, so it never releases. This must fire on the *first* drag move,
  otherwise the frame-start re-centre would fight the pan.
- **Selection changes** (canvas pick of another body / empty space, Escape,
  tree-select) — every user path that reassigns `selection` also clears
  `lockedId`, keeping the button state coherent (the button reflects
  `lockedId === selectedId`).
- **The body streams out** (zoom out past the system tier → despawn → the
  frame-start solve returns `null`). Intuitive: zoom out far enough and the lock
  lets go.
- **"Return to origin"** is clicked (it jumps the camera away → clear first).

For v1, Lock is a system-tier concept and releases on zoom-out rather than
tracking a despawned body from the cache — simpler, and you almost never zoom
*out* while locked (the point is to dive in).

## UI wiring — `src/ui/inspector.tsx`

- `createInspector(container, actions)` gains
  `actions = { onZoomTo: () => void, onToggleLock: () => void }`.
- `inspector.update(world, selection, lockedId)` gains `lockedId`; stored in a
  `signal` (dedup like `selection`) so the Lock button restyles when it changes.
- Each body panel gains a `footer?: VNode` slot rendered at the bottom of its
  `PANEL_CSS` box. `InspectorPanel` builds the footer per kind — a small
  `ActionFooter` with a "Zoom to" button always, plus a "Lock" toggle for
  planet/moon (active-styled when `lockedId === sel.id`).
- `main.ts` passes `{ onZoomTo: frameSelection, onToggleLock: toggleLock }` and
  the current `lockedId` each frame.

Buttons reuse the panel's monospace styling and `pointer-events:auto`; the
existing `onPickUp` guard (`e.target !== canvas`) already stops HUD clicks from
disturbing the canvas selection.

## Config knobs (`src/config/render.ts`)

- `FRAME_MARGIN` (≈1.4) — breathing room around the framed extent.
- `DISC_FRAME_FACTOR` (≈8) — how many disc radii to show for a satellite-less body.
- (Phase B) `FLY_DURATION_MS` (≈450) — smooth-fly duration.

All presentation/feel → the render config, Pierre's to tune in-browser.

## Testing & handoff

- **Unit tests** (`src/camera/focus.test.ts`): `frameZoom` (fit math + clamping at
  both ends) and `maxApoapsis` (incl. empty list). Pure, Node-run.
- **Static pipeline**: `npm run build` (tsc + vite) and `npm test` green; no
  generation change ⇒ existing determinism tests unaffected.
- **E2E is Pierre's** (per `AGENTS.md`): zoom-to framing per body type, lock
  centring while cranking time scale to watch moons, pan-to-release, zoom-in
  while locked, release on zoom-out / re-select.

## Open questions for Pierre

1. **Planet framing** — confirm "outermost **moon** orbit" (my recommendation) vs.
   "the planet's own orbit around the star" (= re-frame the whole system).
2. **Lock on engage** — keep Lock zoom-neutral (recommended), or have it also run
   the Zoom-to framing in one click?
3. **Universe panel** — leave it with no Zoom-to (Return-to-origin covers it), or
   add one that zooms all the way out to the home galaxy / cosmic scale?
4. **Smooth fly** — ship instant now and add the tween later (assumed), or want the
   tween in the first cut?

## Implementation checklist

- [x] `src/camera/focus.ts`: `frameZoom`, `maxApoapsis` (+ Phase B easing helpers).
- [x] `src/camera/focus.test.ts`: fit/clamp + apoapsis tests.
- [x] `src/config/render.ts`: `FRAME_MARGIN`, `DISC_FRAME_FACTOR` (+ `FLY_DURATION_MS` for B).
- [x] `src/main.ts`: `frameSelection(selection)` (compute centre + extent + zoom, apply instant).
- [x] `src/main.ts`: `lockedId` state + `lockedBodyAbsPos` frame-start re-centre.
- [x] `src/main.ts`: release triggers (pan-drag, selection change, despawn, reset).
- [x] `src/ui/inspector.tsx`: `actions` param, `lockedId` signal, per-panel `footer` + `ActionFooter`.
- [x] `src/main.ts`: pass `actions` + `lockedId` into the inspector.
- [x] Update `docs/features.md` and `docs/INDEX.md`.
- [x] Static pipeline green; hand E2E to Pierre.
- [ ] (Phase B, optional) smooth fly-to tween with input-cancel.
```
