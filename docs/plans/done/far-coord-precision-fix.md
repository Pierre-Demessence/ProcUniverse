# Far-coordinate precision fixes (grid OOM + lock jitter)

Two bugs that only appear **far from the universe origin** (galaxies other than
the home one), both caused by doing arithmetic in **absolute** world coordinates
at large magnitudes, which defeats the floating render origin. Full diagnosis in
the investigation notes; this plan is the fix.

## Root cause recap

Coordinates far out reach ~1e11 AU (nearest other galaxy) up to 1e15+. The
float64 gap between representable numbers (ULP) grows with magnitude — already
~3e-5 AU at the 2nd galaxy, larger beyond. Any code that reconstructs an
absolute coordinate (`local + origin`) at those magnitudes loses precision.

## Fix 1 — grid OOM (`src/render/grid.ts`)

`drawReferenceGrid` (drawn only at the system tier) iterated grid lines in
absolute space:

```js
const absX = rect.x + originX;                       // huge far out
for (let wx = Math.floor(absX / step) * step; wx <= absX + rect.w; wx += step)
```

With `step = niceStep(TARGET_PX / zoom)` tiny at high zoom, `step` drops below
`ULP(absX)`, so `wx += step` never advances → **infinite loop** appending canvas
path segments → out-of-memory crash. `MAX_ZOOM = 1e7` makes this reachable at the
nearest non-home galaxies; the "Zoom to" button is safe only because it stops at a
moderate framing zoom (larger `step`).

**Fix:** iterate in the floating-origin (render) frame, where `rect.x` is small
(bounded by ~a sector) and the ULP is far below any step, so the loop is always
bounded (~viewport/TARGET_PX ≈ 11 lines). Absolute alignment is *unrecoverable*
at these magnitudes anyway (the origin coordinate itself isn't precise to sub-AU),
so the grid is phase-locked to the render frame; the bright axes still mark true
`(0, 0)` via `-origin` (off-screen when far away, exactly as before).

## Fix 2 — lock jitter (`src/main.ts`)

Lock re-centres the camera on the body each frame. `lockedBodyAbsPos` returns the
body's small render-frame position **added onto the huge origin** (`tmp + origin`)
as an absolute coordinate; the render then subtracts the origin back
(`localCam.x = camera.x - renderOriginX`). That round-trip quantises to
`ULP(origin)`, so the reconstructed centre jitters by ~`ULP(origin) × zoom` px each
frame — invisible near home, a visible shake far out, and worse at high time scale
(a fast body crosses many ULP steps per frame).

**Fix:** keep the frame-start absolute re-centre (needed for tier / `nearestStar`
/ streaming / HUD — those tolerate the quantisation), but when building `localCam`
for the render, override its centre with the locked body's **exact render-frame
position** (`positions.get(lockedId)`), which is small and precise. The body then
sits dead-centre with no round-trip error. When not locked, behaviour is
unchanged.

Known minor edge (pre-existing, not worsened): if the camera crosses a sector
boundary such that `nearestStar` re-picks the origin, the streamed entities
respawn with new ids and the lock releases — rare for a planet orbiting near its
own star.

## Regression test

`src/render/grid.test.ts`: call `drawReferenceGrid` with a **huge origin + high
zoom** through a counting canvas stub and assert the number of `moveTo` calls is
bounded (a plain-node test — would hang/OOM before the fix). Plus a normal-origin
sanity case.

## Testing & handoff

- Static: `npm run build` + `npm test` + lint green.
- E2E is Pierre's (per `AGENTS.md`): scroll-zoom deep into a far galaxy (no crash),
  and lock a planet far out at high time scale (no bounce). Grid alignment near
  home is visually unchanged.

## Checklist

- [x] `src/render/grid.ts`: iterate lines in the render frame; update the doc comment.
- [x] `src/main.ts`: override `localCam` centre from the locked body's exact position.
- [x] `src/render/grid.test.ts`: bounded-loop regression test (huge origin, high zoom).
- [x] Static pipeline green (build · 218 tests · lint); peer-reviewed LGTM.
- [x] E2E (Pierre): scroll-zoom deep into a far galaxy (no crash); lock a planet far out at high time scale (no bounce).
