# Fix: reload state bugs (Three renderer)

Three bugs reported 2026-07-07, all related to what state survives a page reload.

## Root causes

1. **Canvas flash on reload** — `renderFrame` receives `threeActive` (false during
   Three lazy init) instead of `threeMode` (true = user selected Three), so the
   Canvas 2D path draws the full scene while Three loads.

2. **Planet invisible after reload** — `focusZ` (3D camera look-at height) is not
   persisted. Defaults to 0. A planet at non-zero z can end up behind the camera
   or outside the frustum. Canvas 2D is unaffected (pure 2D projection ignores z).

3. **Camera angle not preserved** — `azimuth` and `tilt` (3D orbit state) are not
   persisted. Always reset to defaults on reload.

## Changes

### `src/persistence/save.ts`
- Add `azimuth`, `tilt`, `focusZ` to `SavedView` interface
- `parseView` parses them with sensible defaults (backward-compat with old saves
  that lack these fields)
- `freshSave` default `view: null` unchanged (first visit = framed origin)

### `src/main.ts`
- Restore `azimuth`/`tilt`/`focusZ` from saved view onto the camera controller
- Save them in the teardown `writeSave(...)` alongside x/y/zoom
- Pass `threeMode` (not `threeActive`) to `renderFrame` so the 2D canvas stays
  transparent while Three loads rather than flashing Canvas 2D content

## Checklist

- [x] `SavedView` + fields + parse backward-compat
- [x] Restore azimuth/tilt/focusZ on reload
- [x] Save azimuth/tilt/focusZ in teardown
- [x] `threeMode` → pass `threeMode || threeActive` in renderFrame call
- [x] Build + test + lint green
- [x] Peer review
