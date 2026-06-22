# Plan — Accelerating zoom & grid-aligned scale bar

Two navigation/scale UX upgrades requested mid-realistic-sim. The zoom range is
~10¹² (MIN_ZOOM 1e-8 … MAX_ZOOM 1e4), so traversing planet → star field →
galaxy currently takes ~240 fixed `ZOOM_STEP` wheel notches. And there is no
readout telling the user *what scale* they are viewing at.

## Requirements (EARS)

- WHEN the user scrolls several wheel notches rapidly in one direction, THE
  SYSTEM SHALL ramp the per-notch zoom factor from `ZOOM_STEP` up to
  `ZOOM_STEP_MAX`, so a quick flick crosses the full zoom range.
- WHEN the user pauses or reverses scroll direction, THE SYSTEM SHALL reset to
  the gentle single-notch `ZOOM_STEP` for fine control.
- THE SYSTEM SHALL keep the world point under the cursor fixed while zooming
  (unchanged cursor-pin behaviour).
- THE SYSTEM SHALL display a scale bar one grid-cell wide, labelled with that
  cell's real length, auto-selecting km / AU / ly by magnitude.
- WHILE the view zooms, THE SYSTEM SHALL keep the bar exactly one grid cell wide
  (reusing the grid's `niceStep`), so bar and grid always agree.

## Design

- **Accelerating zoom** — `src/camera/camera-controller.ts` `onWheel`. Track a
  `wheelStreak` accumulator: rapid same-direction notches (gap <
  `ZOOM_STREAK_WINDOW_MS`) increment it up to `ZOOM_STREAK_MAX`; a longer gap or
  a direction flip resets to 0. Per-notch factor is a geometric ramp between the
  two endpoints: `ZOOM_STEP · (ZOOM_STEP_MAX/ZOOM_STEP) ^ (streak/STREAK_MAX)`.
  Cursor-pin math is untouched.
- **Scale bar** — new `src/render/scale-bar.ts`, drawn on-canvas in screen space
  (like the hint), bottom-left above the pan/zoom hint. Cell length =
  `niceStep(TARGET_PX / zoom)` (exported from `grid.ts` so bar and grid share one
  source); bar width px = `cell · zoom`. Label auto-units: km below
  `SCALE_KM_BELOW_AU`, AU up to `SCALE_LY_ABOVE_AU`, ly beyond; non-AU values to
  3 significant figures (AU values are already clean from `niceStep`).
- **Config** — new knobs alongside the existing zoom block: `ZOOM_STEP_MAX`,
  `ZOOM_STREAK_MAX`, `ZOOM_STREAK_WINDOW_MS`, `SCALE_KM_BELOW_AU`,
  `SCALE_LY_ABOVE_AU`.

## Tasks

- [x] Add config knobs (zoom acceleration + scale-bar unit thresholds).
- [x] Accelerating zoom in `camera-controller.ts` `onWheel`.
- [x] Export `niceStep` + `TARGET_PX` from `grid.ts`.
- [x] New `src/render/scale-bar.ts` (`drawScaleBar`, `formatScaleLength`).
- [x] Wire `drawScaleBar` into the `main.ts` render loop.
- [x] Update `docs/codebase.md` + `docs/features.md`.
- [x] Static pipeline green (`npm run build`, `npm test`, `npm run lint`).
- [x] Lightweight peer review.
- [x] Hand off in-browser tuning to Pierre.
