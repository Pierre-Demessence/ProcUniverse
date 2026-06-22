/**
 * Central tuning knobs for the simulation's feel, density, camera, and timing.
 * These are the values you adjust to change how the universe plays — they are
 * deliberately gathered in one place. True physical constants (σ, T☉, AU↔ly, …)
 * live in `generation/units.ts`; per-model physics (IMF, mass–radius, …) stay in
 * their generators. This file holds only the *choices*, not the physics.
 */

// ── Stellar field density & galaxy shape ────────────────────────────────────
// A sector spans `LY_PER_SECTOR` light-years (lower it to pack stars closer —
// easier interstellar travel). Stars are placed by a seeded galaxy **density
// field** rather than a lattice: per sector, `STAR_DENSITY_PEAK` candidate
// positions are drawn and each is kept with probability equal to the normalised
// density there (1 at the core, 0 past the rim). The galaxy is a finite disc of
// radius `GALAXY_RADIUS_LY` with an exponential falloff `GALAXY_SCALE_LENGTH_LY`;
// spiral / barred-spiral galaxies add `GALAXY_ARMS_MIN`–`GALAXY_ARMS_MAX`
// logarithmic arms of pitch `GALAXY_ARM_PITCH_DEG` and contrast
// `GALAXY_ARM_STRENGTH`; the morphology mix (spiral / barred / elliptical /
// lenticular) is drawn by realistic field fractions in `galaxies.ts`.
export const LY_PER_SECTOR = 0.01;
export const STAR_DENSITY_PEAK = 100;
export const GALAXY_RADIUS_LY = 2.5;
export const GALAXY_SCALE_LENGTH_LY = 0.5;
export const GALAXY_ARMS_MIN = 2;
export const GALAXY_ARMS_MAX = 4;
export const GALAXY_ARM_PITCH_DEG = 18;
export const GALAXY_ARM_STRENGTH = 0.7;

// ── Universe: galaxy field, black holes, stellar populations ─────────────
// The universe tiles into galaxy cells of `GALAXY_CELL_LY`; each cell holds one
// galaxy with probability `GALAXY_OCCUPANCY`, its centre jittered within the
// cell, and `GALAXY_DWARF_CHANCE` of them are smaller dwarfs. Each galaxy hosts
// a central black hole whose mass spans `BLACK_HOLE_MASS_MIN`–`MAX` (M☉, scaled
// from galaxy size in an M–σ spirit) and draws at `BLACK_HOLE_DISC_AU` visual
// size. `POP_BIAS` sets how strongly galactic position tilts stellar
// populations — star-forming arms toward hot blue stars, old cores / ellipticals
// toward cool red ones.
export const GALAXY_CELL_LY = 80;
export const GALAXY_OCCUPANCY = 0.55;
export const GALAXY_DWARF_CHANCE = 0.45;
export const BLACK_HOLE_MASS_MIN = 1e6;
export const BLACK_HOLE_MASS_MAX = 1e10;
export const BLACK_HOLE_DISC_AU = 0.5;
export const POP_BIAS = 1.1;
// Drawn galaxy-field sprite radius as a multiple of the galaxy's world radius.
export const GALAXY_SPRITE_SCALE = 2.5;
// Cosmic web: galaxies cluster into filaments / voids via value noise over a
// grid of nodes `COSMIC_WEB_CELLS` galaxy-cells apart. `COSMIC_WEB_STRENGTH` is
// how strongly the local density swings occupancy (0 = uniform);
// `MORPH_DENSITY_BIAS` is how strongly dense regions skew galaxies spheroidal
// (the morphology–density relation).
export const COSMIC_WEB_CELLS = 8;
export const COSMIC_WEB_STRENGTH = 0.7;
export const MORPH_DENSITY_BIAS = 0.25;

// ── Camera & zoom (pixels per AU) ─────────────────────────────────────
// `ZOOM_STEP` is the multiplier per wheel notch; the min/max bound the range
// (planet inspection down to a galaxy-scale field). Rapid consecutive notches
// accelerate: the factor ramps from `ZOOM_STEP` to `ZOOM_STEP_MAX` over
// `ZOOM_STREAK_MAX` notches (chained while the gap stays under
// `ZOOM_STREAK_WINDOW_MS`), so the ~10¹² range is a quick flick rather than ~240
// notches; a pause or direction change resets to the gentle step. `SYSTEM_VIEW_AU`
// is the world height framed at startup; `REBASE_SECTORS` is how far the camera
// may drift (in sectors) before the floating origin re-snaps when zoomed out.
export const MIN_ZOOM = 1e-8;
export const MAX_ZOOM = 1e4;
export const ZOOM_STEP = 1.12;
export const ZOOM_STEP_MAX = 2.5;
export const ZOOM_STREAK_MAX = 16;
export const ZOOM_STREAK_WINDOW_MS = 220;
export const SYSTEM_VIEW_AU = 40;
export const REBASE_SECTORS = 8;

// ── On-screen scale bar (world unit = AU) ────────────────────
// The HUD scale bar mirrors one reference-grid cell and labels its real length.
// A cell below `SCALE_KM_BELOW_AU` is shown in kilometres, at or above
// `SCALE_LY_ABOVE_AU` in light-years, otherwise in AU.
export const SCALE_KM_BELOW_AU = 0.01;
export const SCALE_LY_ABOVE_AU = 10000;

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
export const GALAXY_FIELD_SECTORS = 8000;
export const UNIVERSE_SECTORS = 80000;
export const TIER_HYSTERESIS = 1.25;
export const TIER_FADE_MS = 220;

// ── Orbital architecture ──────────────────────────────────────────────
// Planet count per system, the inner-edge orbit and the geometric ratio
// (Titius–Bode-like) between successive orbits, and the max eccentricity
// (squared-biased toward circular). Distances in AU.
export const PLANET_MIN = 1;
export const PLANET_MAX = 5;
export const ORBIT_INNER_AU = 0.25;
export const ORBIT_RATIO_MIN = 1.4;
export const ORBIT_RATIO_MAX = 2;
export const ECC_MAX = 0.4;

// ── Visual disc sizing (non-physical, AU) ─────────────────────────────
// A real star/planet is a rounding error at AU scale, so the drawn disc is a
// deliberately exaggerated function of physical radius (log-mapped, clamped).
// Tune these to make bodies bigger/smaller without touching their real data.
export const STAR_DISC_BASE_AU = 0.16;
export const STAR_DISC_PER_DECADE_AU = 0.09;
export const STAR_DISC_MIN_AU = 0.05;
export const STAR_DISC_MAX_AU = 0.7;
export const PLANET_DISC_BASE_AU = 0.05;
export const PLANET_DISC_PER_DECADE_AU = 0.045;
export const PLANET_DISC_MIN_AU = 0.02;
export const PLANET_DISC_MAX_AU = 0.18;

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
