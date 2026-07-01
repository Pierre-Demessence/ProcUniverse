# Floating camera origin (make the camera coordinate relative)

The renderer already works in a small floating-origin frame, but the **camera
state** (`camera.x/y`) is stored as **absolute** world AU, and every pan/zoom
mutates those huge numbers. Far from the universe origin the float64 gap (ULP)
between representable values grows past the size of a pan/zoom step, so the steps
are lost or quantised. This plan makes the camera coordinate **relative to the
floating origin** so all interaction math runs on small, precise numbers — the
root fix for pan, zoom precision, and (retroactively) the lock/grid issues.

## Symptoms this fixes

- **Pan does nothing, then jumps** at high zoom far out: `camera.x -= dx/zoom` adds
  a sub-ULP delta to a huge `camera.x`, which rounds back to the same value until
  the accumulated intent crosses a ULP step.
- **Zoom is imprecise** far out: the cursor re-pin subtracts two huge absolute
  world points, quantising the correction so the point under the cursor drifts.

## Full audit — where absolute coordinates are used

I audited every `camera.x/y`, origin reconstruction (`local + origin`), and
`viewToWorld`/`cameraViewRect` site. Categorised by risk:

### Critical — precision-breaking, must fix

| Site | Problem |
|---|---|
| `src/camera/camera-controller.ts` pan (`camera.x -= dx/zoom`) | sub-ULP delta added to huge `camera.x` → lost / jumpy |
| `src/camera/camera-controller.ts` zoom re-pin (`before.wx − after.wx` via `viewToWorld(..,camera)`) | difference of two huge absolutes → quantised cursor pin |
| `src/main.ts` `localCam = camera − renderOrigin` | huge − huge → the render frame is quantised (this is what made **lock** jitter; already patched by a localCam override) |

### Already patched (same root, leaking through)

| Site | Status |
|---|---|
| `src/render/grid.ts` grid loop stepped in absolute space | **fixed** (iterates in the render frame) |
| `src/main.ts` lock re-centre round-trip | **fixed** (localCam override) — this refactor subsumes it |

### Benign — tolerant of the quantisation (no fix required, but noted)

| Site | Why it's fine |
|---|---|
| `src/lod/tier.ts` `selectTier` | uses `sectorsAcross` = zoom + viewport only, **position-independent** |
| `src/render/scale-bar.ts` | uses `cam.zoom` only, position-independent |
| `src/lod/tier.ts` `visibleSectors` (`floor(absX / SECTOR_SIZE)`) | floors to 63 241-AU sectors; a ~2e-3 AU error is irrelevant |
| `src/main.ts` `nearestStar(camAbs)` | scans a sector for the closest star; sub-AU error can't change the winner |
| `src/render/draw-coords.ts` (`formatCoord(cam.x)`, `cam.x − galaxy.centerX`) | HUD readout only — cosmetic |
| `galaxyAt(seed, cam.x, cam.y)` | floors to 2-Mly galaxy cells — robust |
| `src/render/draw-galaxy*.ts` / `draw-universe.ts` cell centres (`wxAbs − origin`) | drawn at zoomed-out tiers where quantisation × zoom is sub-pixel |
| `src/pick.ts` `pickGalaxyAt` (`wx + origin`) | galaxy pick tolerance is a whole sprite radius |
| `src/generation/spawn.ts` `cx − originX` for **non-focused** systems | at the system tier the origin is the focus star (its local = 0, exact); other systems are off-screen |

### Inherent — not a bug

- `src/generation/universe.ts` star positions (`sx*SECTOR_SIZE + …`) have ULP
  granularity far out. That's a property of storing absolute positions in data;
  it never matters because we only ever *view* relative to a nearby origin.

**Conclusion:** the only precision-critical sites are the three "Critical" rows —
all three are the camera coordinate being absolute. Fix that and the class is
closed; everything else is either already patched or provably tolerant.

## Design — camera position relative to the floating origin

Keep the single floating origin the renderer already maintains (`renderOriginX/Y`
— the nearest star at the system tier for canvas disc precision, sector-snapped
when zoomed out) and **store the camera as a small offset from it**:

- `camera.x/y` become the **local** offset from `renderOrigin` (bounded to a few
  sectors by rebasing). Absolute camera position = `renderOrigin + camera.x`.
- **Pan / zoom mutate `camera.x/y` (small)** → deltas never fall below the ULP.
  The camera controller needs **no change** — it already mutates `camera.x/y`;
  those values are just small now.
- **Render:** `localCam = camera` directly (the origin is already subtracted) —
  no huge − huge, so the frame is exact. The `localCam` lock override becomes
  unnecessary (the body is centred by setting `camera.x` to its local position).
- **When the origin changes** (nearest-star switch, or a zoomed-out rebase),
  adjust the camera to keep the absolute position stable:
  `camera.x += oldOrigin − newOrigin`, then re-stream (as today). At zoomed-out
  tiers both origins are exact sector multiples so the delta is exact; at the
  system tier a nearest-star switch introduces a one-time ~2e-3 AU (≈300 km)
  quantisation — negligible, and rare (you cross systems by zooming out and in).

### Where absolute is still needed

Reconstruct it once per frame — `const camAbsX = renderOriginX + camera.x` — for
the *tolerant* consumers only: `visibleSectors` (sector indexing), `nearestStar`,
`galaxyAt`, `drawCoords`, and `writeSave`. Each floors or displays, so the ~2e-3
AU reconstruction error is irrelevant. The **precise** path (pan, zoom, render,
lock, grid) uses `camera.x` (local) directly and never reconstructs an absolute.

### Setters (frame origin / frame-selection / lock)

These take absolute targets and must set the **local** camera:
`camera.x = targetAbs − renderOriginX` (rebasing the origin onto the target first
when it's far), so the stored offset stays small.

### Save format — no migration

`SavedView { x, y, zoom }` stays **absolute** (`renderOrigin + camera.x` on write;
on load set `renderOrigin = snap(x)`, `camera.x = x − renderOrigin`). Version
stays 1; existing saves keep working.

## Interaction with the shipped grid/lock fixes

- **Grid** (local-frame iteration): unchanged and still correct — `localCam` is
  small either way.
- **Lock** (localCam override): becomes redundant once `camera.x` is local
  (`localCam = camera`, and the lock sets `camera.x` to the body's local
  position). Remove the override as part of this refactor to avoid two mechanisms
  doing the same job.

## Testing

- New pure helpers in a small camera module (unit-tested under Node):
  - `cameraAbsolute(originX, localX) → number`.
  - `rebaseOrigin(originX, localX, targetOriginX) → { originX, localX }` (shifts a
    whole delta between origin and local, absolute preserved).
  - A **pan-precision** test: with a huge origin (1e13) and high zoom, applying
    many small local pan deltas accumulates correctly (the pre-fix absolute path
    would lose them) — asserts the summed offset equals the expected value.
- Static: `npm run build` + `npm test` + lint green.
- E2E is Pierre's (per `AGENTS.md`): pan smoothly at high zoom in a far galaxy;
  zoom precisely (cursor point stays put); confirm lock/grid still correct and the
  saved view restores.

## Risks / edge cases

- Nearest-star origin switch mid-pan at the system tier → one-time ~300 km
  absolute nudge (invisible; only touches the coord readout/save).
- Every consumer that today reads `camera.x` as absolute must be routed through
  `camAbsX` — the audit above is the complete list; the peer review should verify
  none was missed.

## Checklist

- [x] Pure camera helpers + tests (`cameraAbsolute`, `rebaseLocal`, pan-precision).
- [x] `src/main.ts`: store `camera.x/y` as the offset from `renderOrigin`; adjust on every origin change; `localCam = camera`.
- [x] `src/main.ts`: route the tolerant consumers through `camAbsX/Y` (`visibleSectors`, `nearestStar`, `galaxyAt`, `drawCoords`, `writeSave`).
- [x] `src/main.ts`: convert `frameOrigin` / `frameSelection` / lock setters to set the local camera; remove the now-redundant lock `localCam` override.
- [x] Confirm the camera controller needs no change (mutates the now-small `camera.x/y`).
- [x] Save: absolute on write, local on load, no format change (handled in `main.ts`; `save.ts` untouched).
- [x] Static pipeline green (build · 222 tests · lint); peer-reviewed LGTM.
- [x] E2E confirmed by Pierre (smooth pan + precise zoom in a far galaxy).

```
