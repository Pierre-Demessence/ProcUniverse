/**
 * Central tuning knobs for the simulation's feel, density, camera, and timing.
 * These are the values you adjust to change how the universe plays — they are
 * deliberately gathered in one place. True physical constants (σ, T☉, AU↔ly, …)
 * live in `generation/units.ts`; per-model physics (IMF, mass–radius, …) stay in
 * their generators. This file holds only the *choices*, not the physics.
 */

// ── Stellar field density ─────────────────────────────────────────────
// How far apart stars are. A sector spans `LY_PER_SECTOR` light-years and is
// divided into a `SUBGRID × SUBGRID` lattice; each cell has a star unless it
// rolls empty, jittered off the lattice by a fraction of a cell. Lower
// `LY_PER_SECTOR` to pack stars closer together (easier interstellar travel).
export const LY_PER_SECTOR = 6;
export const SUBGRID = 4;
export const EMPTY_CHANCE = 0.3;
export const JITTER_FRACTION = 0.15;

// ── Camera & zoom (pixels per AU) ─────────────────────────────────────
// `ZOOM_STEP` is the multiplier per wheel notch; the min/max bound the range
// (planet inspection down to a galaxy-scale field). `SYSTEM_VIEW_AU` is the
// world height framed at startup. `REBASE_SECTORS` is how far the camera may
// drift (in sectors) before the floating origin re-snaps when zoomed out.
export const MIN_ZOOM = 1e-8;
export const MAX_ZOOM = 1e4;
export const ZOOM_STEP = 1.12;
export const SYSTEM_VIEW_AU = 40;
export const REBASE_SECTORS = 8;

// ── Level-of-detail tiers ─────────────────────────────────────────────
// `SYSTEM_TIER_MAX_AU` collapses a system to a dot once the view is wider than
// this; `GALAXY_TIER_SECTORS` switches to the density glow above this many
// sectors across. `TIER_HYSTERESIS` is the dead-band that stops boundary
// thrash; `TIER_FADE_MS` is the cross-fade duration between tiers.
export const SYSTEM_TIER_MAX_AU = 300;
export const GALAXY_TIER_SECTORS = 16;
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
