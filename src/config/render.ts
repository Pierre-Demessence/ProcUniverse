/**
 * Presentation & feel knobs: how the (data-defined) universe is drawn and
 * interacted with — the camera & zoom, LOD tiers, the non-physical visual disc /
 * sprite sizes, the scale bar, HUD placement, body picking, and the time
 * controls. Changing any of these leaves the universe itself unchanged; it only
 * changes the view. The universe-defining knobs live in `data.ts`.
 */

// ── Camera & zoom (pixels per AU) ─────────────────────────────────────
// `ZOOM_STEP` is the multiplier per wheel notch; the min/max bound the range
// (planet inspection out to the whole cosmic web). Rapid consecutive notches
// accelerate: the factor ramps from `ZOOM_STEP` to `ZOOM_STEP_MAX` over
// `ZOOM_STREAK_MAX` notches (chained while the gap stays under
// `ZOOM_STREAK_WINDOW_MS`), so the ~10¹⁶ range is a quick flick rather than
// hundreds of notches; a pause or direction change resets to the gentle step.
// `SYSTEM_VIEW_AU` is the world height framed at startup; `REBASE_SECTORS` is how
// far the camera may drift (in sectors) before the floating origin re-snaps when
// zoomed out.
export const MIN_ZOOM = 1e-12;
export const MAX_ZOOM = 1e4;
export const ZOOM_STEP = 1.12;
export const ZOOM_STEP_MAX = 2.5;
export const ZOOM_STREAK_MAX = 16;
export const ZOOM_STREAK_WINDOW_MS = 220;
export const SYSTEM_VIEW_AU = 40;
export const REBASE_SECTORS = 8;

// ── On-screen scale bar (world unit = AU) ────────────────────
// The HUD scale bar mirrors one reference-grid cell and labels its real length.
// A cell below `SCALE_KM_BELOW_AU` is shown in km (or Mkm when ≥ 1e6 km),
// at or above `SCALE_LY_ABOVE_AU` in light-years, otherwise in AU.
export const SCALE_KM_BELOW_AU = 1;
export const SCALE_LY_ABOVE_AU = 10000;

// ── Location tree & perf-monitor placement ───────────────────────────
// The location tree pins to the top-left; each deeper level is inset by
// `NAV_TREE_INDENT_PX`. The canvas perf-monitor moves to the top-right, just
// left of the sim-time panel. `STATS_HUD_RIGHT_RESERVE_PX` (the CSS-pixel column
// the sim panel occupies), `STATS_HUD_GAP_PX`, and `STATS_HUD_TOP_PX` are CSS
// pixels — scaled by the device pixel ratio to track the DOM sim panel.
// `STATS_HUD_WIDTH_PX` is the overlay's own width in *backing* pixels (it renders
// dpr-independently): a generous estimate used to place its left edge so it sits
// snug left of the sim panel at any dpr — over-estimating only widens the gap.
export const NAV_TREE_INDENT_PX = 14;
export const STATS_HUD_TOP_PX = 10;
export const STATS_HUD_RIGHT_RESERVE_PX = 204;
export const STATS_HUD_GAP_PX = 40;
export const STATS_HUD_WIDTH_PX = 160;

// ── Inspector / body picking ──────────────────────────────────────────
// A body within `PICK_PX` screen pixels of the cursor (or inside its drawn
// disc, whichever is larger) is selectable. A pointer gesture only counts as a
// click when it moves less than `CLICK_SLOP_PX`; anything more is a pan and
// never selects, so dragging the view never pins a panel.
export const PICK_PX = 14;
export const CLICK_SLOP_PX = 5;

// ── Level-of-detail tiers ─────────────────────────────────────────────
// Zoom-bounded tiers (in → out): system, star, galaxy (one galaxy's density
// glow), galaxy-field (each galaxy a discrete sprite), universe (the cosmic
// glow). `SYSTEM_TIER_MAX_AU` collapses a system to a dot; the `*_SECTORS`
// thresholds switch tiers at that many sectors across. `TIER_HYSTERESIS` is the
// dead-band that stops boundary thrash; `TIER_FADE_MS` is the tier cross-fade.
export const SYSTEM_TIER_MAX_AU = 300;
export const GALAXY_TIER_SECTORS = 16;
export const GALAXY_FIELD_SECTORS = 300000;
export const UNIVERSE_SECTORS = 100000000;
export const TIER_HYSTERESIS = 1.25;
export const TIER_FADE_MS = 220;

// ── Visual disc sizing (non-physical, AU) ─────────────────────────────
// Bodies are currently drawn at their true physical radius (see `scale.ts`), so
// these are dormant. They are the tuning inputs for the planned zoom-aware
// apparent-size morph (Phase 4): a floor size a body never shrinks below, so
// stars and planets stay visible and correctly ordered when zoomed out, while
// true physical size takes over as you zoom in. Log-mapped, clamped.
export const STAR_DISC_BASE_AU = 0.16;
export const STAR_DISC_PER_DECADE_AU = 0.09;
export const STAR_DISC_MIN_AU = 0.05;
export const STAR_DISC_MAX_AU = 0.7;
export const PLANET_DISC_BASE_AU = 0.05;
export const PLANET_DISC_PER_DECADE_AU = 0.045;
export const PLANET_DISC_MIN_AU = 0.02;
export const PLANET_DISC_MAX_AU = 0.18;

// ── Galaxy-field & black-hole visual sizes ────────────────────────────
// `GALAXY_SPRITE_SCALE` is the drawn galaxy-field sprite radius as a multiple of
// the galaxy's world radius. `BLACK_HOLE_DISC_AU` is dormant (black holes now
// draw at their true Schwarzschild radius), kept for the apparent-size morph.
export const GALAXY_SPRITE_SCALE = 2.5;
export const BLACK_HOLE_DISC_AU = 4;

// ── Simulation time ───────────────────────────────────────────────────
// The calendar epoch (second 0 of the sim clock) and the time-scale slider's
// discrete speed stops, in simulated seconds per real second (index 0 pauses).
// Orbital periods are real years, so the high stops are needed to see motion.
export const SIM_EPOCH_MS = Date.UTC(2100, 0, 1);
export const SPEED_STEPS = [
  0,
  0.25,
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  4,
  10,
  60,
  3600,
  86400,
  432000,
  2592000,
  31557600,
  315576000,
];
export const DEFAULT_SPEED_INDEX = 14; // 5 days/s — lively but calm for year-long orbits
