/**
 * Presentation & feel knobs: how the (data-defined) universe is drawn and
 * interacted with — the camera & zoom, LOD tiers, the non-physical visual disc /
 * sprite sizes, the scale bar, HUD placement, body picking, and the time
 * controls. Changing any of these leaves the universe itself unchanged; it only
 * changes the view. The universe-defining knobs live in `data.ts`.
 */

import type { AtmosphereKind, AtmosphereLook, CloudKind, CloudLook, MoonTuning, RockyTuning } from '../render/three/planet-surface';

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
export const MAX_ZOOM = 1e7;
export const ZOOM_STEP = 1.12;
export const ZOOM_STEP_MAX = 2.5;
export const ZOOM_STREAK_MAX = 16;
export const ZOOM_STREAK_WINDOW_MS = 220;
export const SYSTEM_VIEW_AU = 40;
export const REBASE_SECTORS = 8;

// ── 3D system view (Three backend, system tier) ─────────────────────
// The system tier renders as lit, rotating spheres seen by a perspective camera
// you can orbit + tilt with a right-drag (left-drag still pans, wheel still
// zooms). `CAMERA_FOV_DEG` is the vertical field of view; the camera distance is
// derived from `zoom` so the framing matches the 2D view. `ORBIT_SENSITIVITY` is
// radians of orbit per drag pixel. The tilt (polar angle away from the focused
// system's plane normal) is unbounded — the camera can roll over the pole, under
// the disk and back round, trackball style; `TILT_DEFAULT` is the gentle starting
// tilt. `FLAT_TILT` is the polar angle the "Flatten" toggle drops to: straight
// down the system plane, so orbits read as circles.
// `SPHERE_*_SEGMENTS` set the sphere tesselation; `STAR_SPIN_RATE` spins stars
// (which carry no rotation data) slowly. `LIGHT_AMBIENT` is the small fill that
// keeps a body's star-facing-away side readable; `LIGHT_STAR_BASE` is the
// point-light intensity for a Sun-luminosity star placed at the star's position
// (scaled per star by luminosity in `starLightIntensity`).
export const CAMERA_FOV_DEG = 50;
export const ORBIT_SENSITIVITY = 0.006;
export const TILT_DEFAULT = 0.35;
export const FLAT_TILT = 0;
export const SPHERE_WIDTH_SEGMENTS = 32;
export const SPHERE_HEIGHT_SEGMENTS = 24;
// Width (px) of a planet's baked equirectangular surface map (height = width/2);
// see docs/plans/planet-surfaces.md §3.2.
export const PLANET_SURFACE_MAP_WIDTH = 1024;
// Moons are small on screen and a giant can hold dozens, so their maps are
// smaller (a 1024-wide half-float map with mips is ~5 MB of GPU memory).
export const MOON_SURFACE_MAP_WIDTH = 256;
// Atmosphere rim glow per atmosphere family (docs/plans/planet-surfaces.md
// Phase 1): a soft halo just outside the limb on the sunlit side. Scale heights
// are exaggerated far beyond the real ~0.1 % of a radius so the glow reads at
// system-view sizes. Tuned in the planet lab (`/lab.html`).
export const ATMOSPHERE_LOOKS: Readonly<Record<AtmosphereKind, AtmosphereLook>> = {
  'co2-runaway': { intensity: 0.9, scaleHeight: 0.04, tint: '#f0dca0', twilight: 0.35 },
  'hydrogen': { intensity: 0.6, scaleHeight: 0.03, tint: '#d9e2ff', twilight: 0.2 },
  'methane': { intensity: 0.8, scaleHeight: 0.03, tint: '#8fe3ee', twilight: 0.2 },
  'n2-co2': { intensity: 1, scaleHeight: 0.025, tint: '#6fa8ff', twilight: 0.25 },
  'thin-n2': { intensity: 0.5, scaleHeight: 0.012, tint: '#a9bcdc', twilight: 0.1 },
};
// Rocky / super-Earth surfaces (Phase 2): land colours blend along the surface-
// temperature anchors (icy → cold rock → temperate → hot rust → scorched →
// molten crust); oceans fill below `seaLevel` on liquid-water worlds; caps grow
// as the world cools from `capWarmK` to `capColdK`; lava glows in the lowlands
// between `moltenStartK` and `moltenFullK`. Relief is exaggerated so terrain
// catches the light. Tuned in the planet lab (`/lab.html`).
// Cloud layer on rocky worlds that keep an atmosphere (Phase 4): a lit,
// translucent shell `CLOUD_ALTITUDE` planet radii above the surface, baked once
// per planet at `CLOUD_MAP_WIDTH`. Earth-like air → broken swirls; runaway CO₂
// → Venus-like total overcast; thin N₂ → sparse wisps. Tuned in the planet lab.
export const CLOUD_ALTITUDE = 0.006;
export const CLOUD_MAP_WIDTH = 1024;
export const CLOUD_LOOKS: Readonly<Record<CloudKind, CloudLook>> = {
  'co2-runaway': { color: '#efe2b8', coverage: 0.9, haze: 0.92, scale: 2.5, softness: 0.25, stretch: 2.5, swirl: 1.5 },
  'n2-co2': { color: '#f4f6f8', coverage: 0.5, haze: 0, scale: 3, softness: 0.08, stretch: 1.6, swirl: 2.5 },
  'thin-n2': { color: '#e6e9ee', coverage: 0.15, haze: 0, scale: 4, softness: 0.1, stretch: 2, swirl: 1.5 },
};
// Moon surfaces (Phase 3): airless bodies at their host planet's temperature,
// grey regolith or ice by bulk density, more heavily cratered than planets.
export const MOON_SURFACE: Readonly<MoonTuning> = {
  continentScale: 2.2,
  craterDensity: 0.75,
  craterDepth: 0.45,
  iceHigh: '#eef1f2',
  iceLow: '#a9a39a',
  iceStableK: 150,
  icyDensity: 2.5,
  rockHigh: '#a8a49e',
  rockLow: '#56544f',
};
export const ROCKY_SURFACE: Readonly<RockyTuning> = {
  capColdK: 120,
  capColdStart: 0.35,
  capColor: '#eef3f6',
  capEdgeNoise: 0.06,
  capWarmK: 300,
  continentScale: 1.6,
  craterAtmosphereFactor: 0.25,
  craterDensity: 0.5,
  craterDepth: 0.35,
  craterScale: 5,
  craterSize: 0.35,
  deepColor: '#0d2a4f',
  diminish: 0.5,
  lavaColor: '#ff5a1a',
  lavaLevel: 0.45,
  moltenFullK: 1500,
  moltenStartK: 900,
  octaves: 8,
  relief: 0.03,
  seaLevel: 0.52,
  shallowColor: '#2a5f8a',
  anchors: [
    { high: '#e4ebf0', low: '#7d8590', tempK: 80 },
    { high: '#b9b1a6', low: '#6b6660', tempK: 200 },
    { high: '#9c8a68', low: '#5d5a3f', tempK: 290 },
    { high: '#b7764a', low: '#6e3b24', tempK: 450 },
    { high: '#7a5a48', low: '#3a2a24', tempK: 800 },
    { high: '#3b2d27', low: '#1d1512', tempK: 1400 },
  ],
};
export const STAR_SPIN_RATE = 5e-8;
export const LIGHT_AMBIENT = 0.15;
export const LIGHT_STAR_BASE = 3;
// Star corona via a post-process bloom pass on the system tier. Stars are
// boosted to HDR (their surface colour × `STAR_EMISSIVE_STRENGTH`) so their core
// exceeds `BLOOM_THRESHOLD` while lit planets (rarely brighter than the
// threshold) mostly do not — selective bloom without MRT plumbing.
// `BLOOM_STRENGTH` scales the added glow; `BLOOM_RADIUS` its spread.
// `STAR_MIN_SCREEN_PX` floors a star's on-screen radius so its true disc, which
// shrinks below a pixel from a distant planet, never fully vanishes — bloom then
// renders the floored dot as a glowing glare point, as a real star stays visible.
export const STAR_EMISSIVE_STRENGTH = 4;
export const STAR_MIN_SCREEN_PX = 2.5;
export const BLOOM_STRENGTH = 0.9;
export const BLOOM_RADIUS = 0.6;
export const BLOOM_THRESHOLD = 1.5;
// MSAA on the Three canvas — smooths sphere / orbit-ring edges. Kept on: the
// system view is not fill-rate bound (the earlier FPS drop was per-object orbit-
// ring overhead, since merged into a single draw call), so MSAA is affordable.
export const RENDER_ANTIALIAS = true;
// Fraction of device resolution the 3D (Three) system view renders at, CSS-
// upscaled. 1 = full device resolution; lower would trade sharpness for fill-rate
// if ever needed (the earlier FPS issue was ring draw overhead, not fill).
export const RENDER_SCALE = 1;

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
// dead-band that stops boundary thrash.
export const SYSTEM_TIER_MAX_AU = 300;
export const GALAXY_TIER_SECTORS = 16;
export const GALAXY_FIELD_SECTORS = 300000;
export const UNIVERSE_SECTORS = 100000000;
export const TIER_HYSTERESIS = 1.25;

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

// ── Body apparent size: the visibility "floor" morph ──────────────────
// In "usable" body scale, a body is never drawn smaller than a floor of
// `bodyFloorPx` screen pixels, so stars / planets / moons stay visible when
// zoomed out; true physical size takes over once it exceeds the floor as you
// zoom in. The floor is a gentle log map of the body's true radius (AU):
// `BODY_FLOOR_BASE_PX` at 1 AU, ±`BODY_FLOOR_PER_DECADE_PX` per decade, clamped
// to [`BODY_FLOOR_MIN_PX`, `BODY_FLOOR_MAX_PX`]. It is monotonic in true radius,
// so a bigger body never floors smaller than a smaller one (no
// planet-larger-than-its-star inversion). "True" body scale ignores the floor.
export const BODY_FLOOR_BASE_PX = 12;
export const BODY_FLOOR_PER_DECADE_PX = 2.2;
export const BODY_FLOOR_MIN_PX = 1.5;
export const BODY_FLOOR_MAX_PX = 14;
// Moons get a slightly higher floor than the base minimum so they read as
// distinct markers around their planet at planet-zoom, not sub-pixel specks.
// ── Camera focus & lock ──────────────────────────────────────────────
// `FRAME_MARGIN` (>1) leaves breathing room around the framed extent so the
// target body and its satellites are not flush against the viewport edge.
// `DISC_FRAME_FACTOR` × disc radius gives the minimum framing extent for a
// satellite-less body so it does not fill the screen when zoomed to.
// `FLY_DURATION_MS` is the smooth fly-to tween duration (Phase B, deferred).
export const FRAME_MARGIN = 1.4;
export const DISC_FRAME_FACTOR = 8;
export const FLY_DURATION_MS = 450;
export const MOON_FLOOR_MIN_PX = 2.5;

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
