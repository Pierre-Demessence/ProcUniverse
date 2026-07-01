/**
 * Data tuning knobs: the values that determine the *generated universe* and its
 * simulation — spatial scale, galaxy shape and field, stellar populations, the
 * cosmic web, and orbital architecture. Changing any of these produces a
 * different (still deterministic) universe. Presentation/feel knobs — camera,
 * zoom, LOD tiers, visual disc/sprite sizes, HUD, picking, time controls — live
 * in `render.ts`. True physical constants (σ, T☉, AU↔ly, …) live in
 * `generation/units.ts`; per-model physics (IMF, mass–radius, …) stay in their
 * generators. This file holds only the *choices*, not the physics.
 */

// ── Stellar field density & galaxy shape ────────────────────────────────────
// A sector spans `LY_PER_SECTOR` light-years — set to a realistic ~1 ly so stars
// sit ~0.1 ly (dense cores) to a few ly (disc) apart. Stars are placed by a
// seeded galaxy **density field** rather than a lattice: per sector,
// `STAR_DENSITY_PEAK` candidate positions are drawn and each is kept with
// probability equal to the normalised density there (1 at the core, 0 past the
// rim) — ~10¹¹ stars in a full galaxy. The galaxy is a finite disc of radius
// `GALAXY_RADIUS_LY` (Milky-Way-sized) with an exponential falloff
// `GALAXY_SCALE_LENGTH_LY`; spiral / barred-spiral galaxies add
// `GALAXY_ARMS_MIN`–`GALAXY_ARMS_MAX` logarithmic arms of pitch
// `GALAXY_ARM_PITCH_DEG` and contrast `GALAXY_ARM_STRENGTH`; the morphology mix
// (spiral / barred / elliptical / lenticular) is drawn by realistic field
// fractions in `galaxies.ts`.
export const LY_PER_SECTOR = 1;
export const STAR_DENSITY_PEAK = 100;
export const GALAXY_RADIUS_LY = 50000;
export const GALAXY_SCALE_LENGTH_LY = 10000;
export const GALAXY_ARMS_MIN = 2;
export const GALAXY_ARMS_MAX = 4;
export const GALAXY_ARM_PITCH_DEG = 18;
export const GALAXY_ARM_STRENGTH = 0.7;

// ── Universe: galaxy field, black holes, stellar populations ─────────────
// The universe tiles into galaxy cells of `GALAXY_CELL_LY` (~2 Mly, so galaxies
// sit roughly Andromeda-distance apart); each cell holds one galaxy with
// probability `GALAXY_OCCUPANCY`, its centre jittered within the cell, and
// `GALAXY_DWARF_CHANCE` of them are smaller dwarfs. Each galaxy hosts a central
// black hole whose mass spans `BLACK_HOLE_MASS_MIN`–`MAX` (M☉, scaled from
// galaxy size in an M–σ spirit). `POP_BIAS` sets how strongly galactic position
// tilts stellar populations — star-forming arms toward hot blue stars, old
// cores / ellipticals toward cool red ones.
export const GALAXY_CELL_LY = 2000000;
export const GALAXY_OCCUPANCY = 0.55;
export const GALAXY_DWARF_CHANCE = 0.45;
export const BLACK_HOLE_MASS_MIN = 1e6;
export const BLACK_HOLE_MASS_MAX = 1e10;
export const POP_BIAS = 1.1;

// ── Cosmic web ────────────────────────────────────────────────────────
// Galaxies cluster into filaments / voids via value noise over a grid of nodes
// `COSMIC_WEB_CELLS` galaxy-cells apart. `COSMIC_WEB_STRENGTH` is how strongly
// the local density swings occupancy (0 = uniform); `MORPH_DENSITY_BIAS` is how
// strongly dense regions skew galaxies spheroidal (the morphology–density
// relation).
export const COSMIC_WEB_CELLS = 8;
export const COSMIC_WEB_STRENGTH = 0.7;
export const MORPH_DENSITY_BIAS = 0.25;

// ── Orbital architecture ──────────────────────────────────────────────
// Planet count per system, then a planet-forming disk that scales with the host
// star. Its inner edge tracks the dust-sublimation radius (∝ √L, anchored at
// ORBIT_INNER_AU for the Sun, floored at ORBIT_INNER_MIN_AU so faint stars never
// place a planet inside themselves); successive orbits step out by a geometric
// ratio (Titius–Bode-like), tight inside the frost line and wider in the cold
// outer region where giants form. The disk's outer edge also scales (∝ √L from
// DISK_OUTER_AU) but saturates at DISK_OUTER_MAX_AU — a realistic maximum extent
// that also keeps every system well inside a sector — and planets stop there (a
// smaller disk simply holds fewer). So a luminous star's planets start farther
// out and reach its distant habitable zone / frost line, while a dim star's hug
// it. Eccentricity is squared-biased toward circular. Distances in AU.
export const PLANET_MIN = 1;
export const PLANET_MAX = 8;
export const ORBIT_INNER_AU = 0.04;
export const ORBIT_INNER_MIN_AU = 0.01;
export const ORBIT_RATIO_MIN = 1.4;
export const ORBIT_RATIO_MAX = 2.2;
export const ORBIT_RATIO_OUTER_MIN = 1.6;
export const ORBIT_RATIO_OUTER_MAX = 2.5;
export const DISK_OUTER_AU = 50;
export const DISK_OUTER_MAX_AU = 150;
export const ECC_MAX = 0.4;
