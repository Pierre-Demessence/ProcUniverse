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
// Space is cut into cubic sectors `LY_PER_SECTOR` light-years on a side (4 ly:
// the cheapest edge to fill a star-tier view, measured in
// docs/plans/universe-3d.md). Stars are placed by a seeded 3D galaxy **density
// field** rather than a lattice: each sector draws a Poisson number of
// candidates from an upper bound of the density over the cube and thins each by
// the true density there. `STAR_DENSITY_PEAK` is the star count per ly³ where
// the normalised density is 1 (a galaxy core); it is calibrated so the
// azimuth-averaged disk mid-plane 25,000 ly out holds ~0.004 stars / ly³, as
// near the Sun. `STAR_DENSITY_SCALE` multiplies it (a feel knob; 1 = realistic).
// Each disk galaxy is a thin disk of radius `GALAXY_RADIUS_LY` (Milky-Way-sized)
// with an exponential radial falloff `GALAXY_SCALE_LENGTH_LY` and a `sech²`
// vertical profile of scale height `GALAXY_DISK_SCALE_HEIGHT_LY`
// × `GALAXY_DISK_PUFF` (1 = realistic; raise it for a chunkier disk), plus a
// spheroidal bulge and a faint halo (`GALAXY_HALO_DENSITY`, the halo's
// normalised density at the centre). Spiral / barred-spiral galaxies add
// `GALAXY_ARMS_MIN`–`GALAXY_ARMS_MAX` logarithmic arms of pitch
// `GALAXY_ARM_PITCH_DEG` and contrast `GALAXY_ARM_STRENGTH`; ellipticals are
// triaxial ellipsoids; the morphology mix is drawn by realistic field fractions
// in `galaxies.ts`.
export const LY_PER_SECTOR = 4;
export const STAR_DENSITY_PEAK = 0.09;
export const STAR_DENSITY_SCALE = 1;
export const GALAXY_RADIUS_LY = 50000;
export const GALAXY_SCALE_LENGTH_LY = 10000;
export const GALAXY_DISK_SCALE_HEIGHT_LY = 1000;
export const GALAXY_DISK_PUFF = 1;
export const GALAXY_HALO_DENSITY = 0.12;
export const GALAXY_ARMS_MIN = 2;
export const GALAXY_ARMS_MAX = 4;
export const GALAXY_ARM_PITCH_DEG = 18;
export const GALAXY_ARM_STRENGTH = 0.7;

// ── Universe: galaxy field, black holes, stellar populations ─────────────
// The universe tiles into cubic galaxy cells of `GALAXY_CELL_LY` (~2 Mly, so
// galaxies sit roughly Andromeda-distance apart); each cell holds one galaxy with
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

// Orbital inclination (3D tilt). A planet's tilt from its system's mean plane is
// Rayleigh-distributed with a spread proportional to its own eccentricity —
// dynamically hot orbits are both stretched and tilted (energy equipartition,
// Xie et al. 2016) — and scaled by a multiplicity factor that shrinks as the
// planet count grows, so crowded systems stay flat and sparse ones run tilted
// (the "Kepler dichotomy"). σ_i(rad) = INCLINATION_ECC_RATIO · e · factor.
export const INCLINATION_ECC_RATIO = 0.5;
export const INCLINATION_MULT_HOT = 2.5;
export const INCLINATION_MULT_COLD = 1;
