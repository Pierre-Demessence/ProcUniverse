/**
 * Pure, data-driven helpers for procedural planet surfaces and atmospheres (see
 * docs/plans/planet-surfaces.md). Kept free of any Three.js / TSL import so they
 * are cheap to unit test; the TSL side (`planet-material.ts`, `surface-bake.ts`,
 * `atmosphere-material.ts`) mirrors the maths here.
 */

import type { MoonPhysical } from '../../generation/moons';
import type { PlanetPhysical, PlanetType } from '../../generation/planets';

import { atmosphereType, escapeVelocity, retainsAtmosphere, surfaceTemperature } from '../../generation/planets';

/** Range of the per-body noise offset returned by `varietySeed`. */
export const VARIETY_SEED_RANGE = 1000;

const scratch = new DataView(new ArrayBuffer(8));

/**
 * A stable per-body noise offset in `[0, VARIETY_SEED_RANGE)`, hashed from
 * already-generated physical values so two same-type bodies look different
 * without a new RNG draw (the universe stays byte-identical).
 */
export function varietySeed(values: readonly number[]): number {
  // FNV-1a over the IEEE-754 bytes: every bit of each value contributes, so
  // bodies differing only in a low decimal still get unrelated offsets.
  let h = 0x811C9DC5;
  for (const value of values) {
    scratch.setFloat64(0, value);
    for (let i = 0; i < 8; i++) {
      h ^= scratch.getUint8(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return ((h >>> 0) / 0x100000000) * VARIETY_SEED_RANGE;
}

/** `varietySeed` of a planet's physical values. */
export function planetVarietySeed(planet: Pick<PlanetPhysical, 'equilibriumTemp' | 'mass' | 'radius' | 'rotationPeriod'>): number {
  return varietySeed([planet.mass, planet.radius, planet.equilibriumTemp, planet.rotationPeriod]);
}

/**
 * Unit direction on a Three.js `SphereGeometry` for texture coordinate `(u, v)`
 * — the equirectangular mapping a baked surface map uses, so the map lines up
 * with the sphere's own UVs (no longitude seam). `v = 1` is the +Y (spin) pole.
 */
export function equirectDirection(u: number, v: number): [number, number, number] {
  const phi = u * Math.PI * 2;
  const theta = (1 - v) * Math.PI;
  const s = Math.sin(theta);
  return [-Math.cos(phi) * s, Math.cos(theta), Math.sin(phi) * s];
}

/** Stable atmosphere families, one per `atmosphereType` label. */
export type AtmosphereKind = 'co2-runaway' | 'hydrogen' | 'methane' | 'n2-co2' | 'thin-n2';

export const ATMOSPHERE_KINDS: readonly AtmosphereKind[] = ['hydrogen', 'methane', 'co2-runaway', 'n2-co2', 'thin-n2'];

const KIND_BY_LABEL: Readonly<Record<string, AtmosphereKind>> = {
  'CO₂ (runaway)': 'co2-runaway',
  'H/He + methane': 'methane',
  'Hydrogen / helium': 'hydrogen',
  'N₂ / CO₂': 'n2-co2',
  'Thin N₂': 'thin-n2',
};

/** How one atmosphere family's rim glow looks (tuned in the planet lab). */
export interface AtmosphereLook {
  /** Glow brightness multiplier. */
  intensity: number;
  /** Density falloff length as a fraction of the planet radius (visual, exaggerated). */
  scaleHeight: number;
  /** Glow colour (raw sRGB hex), further tinted by the star's light. */
  tint: string;
  /** How far past the terminator the glow wraps into the night side (0..1). */
  twilight: number;
}

/**
 * The planet's atmosphere family, or null when it keeps none — the same
 * cosmic-shoreline rule and labels the inspector shows.
 */
export function atmosphereKind(planet: Pick<PlanetPhysical, 'equilibriumTemp' | 'insolation' | 'mass' | 'radius' | 'type'>): AtmosphereKind | null {
  const has = retainsAtmosphere(escapeVelocity(planet.mass, planet.radius), planet.insolation);
  return KIND_BY_LABEL[atmosphereType(planet.type, has, planet.equilibriumTemp)] ?? null;
}

/**
 * The shell extends this many scale heights above the surface; the glow has
 * fallen to e⁻⁶ ≈ 0.25 % there, so the shell's edge never shows.
 */
export const SHELL_SCALE_HEIGHTS = 6;

/** Atmosphere shell radius in planet radii. */
export function shellRadius(scaleHeight: number): number {
  return 1 + SHELL_SCALE_HEIGHTS * scaleHeight;
}

/**
 * Relative atmosphere column along a sight line whose closest approach to the
 * planet centre is `d` (planet radii). Past the limb (`d ≥ 1`) it follows the
 * exponential density at that altitude; across the disc (`d < 1`) it is the
 * slant path `H / cos(zenith)`, normalised to the limb column `√(2πH)` and
 * capped at 1 so the two branches meet at the limb. Mirrored in TSL by
 * `atmosphere-material.ts`.
 */
export function atmosphereColumn(d: number, scaleHeight: number): number {
  if (d >= 1)
    return Math.exp(-(d - 1) / scaleHeight);
  const cosZenith = Math.sqrt(Math.max(1 - d * d, 1e-4));
  return Math.min(Math.sqrt(scaleHeight / (2 * Math.PI)) / cosZenith, 1);
}

/** Planet types drawn with the rocky surface (giants get their own in Phase 5). */
export function isRockyType(type: PlanetType): boolean {
  return type === 'rocky' || type === 'super-earth';
}

/** A land-colour stop on the surface-temperature scale. */
export interface PaletteAnchor {
  /** Highland colour (raw sRGB hex). */
  high: string;
  /** Lowland colour (raw sRGB hex). */
  low: string;
  tempK: number;
}

/** Global look knobs for rocky surfaces (tuned in the planet lab). */
export interface RockyTuning {
  /** Land colours by surface temperature, ascending `tempK`. */
  anchors: PaletteAnchor[];
  capColdK: number;
  /** |latitude| (sphere y) where caps start on the coldest worlds. */
  capColdStart: number;
  capColor: string;
  capEdgeNoise: number;
  /** Surface temperature at and above which caps vanish. */
  capWarmK: number;
  continentScale: number;
  /** Crater strength kept on worlds with an atmosphere (erosion); airless = 1. */
  craterAtmosphereFactor: number;
  /** Fraction of cells that hold a crater. */
  craterDensity: number;
  craterDepth: number;
  craterScale: number;
  /** Crater radius as a fraction of a cell (≤ 0.5). */
  craterSize: number;
  deepColor: string;
  /** Noise roughness: amplitude kept per octave. */
  diminish: number;
  lavaColor: string;
  /** Height below which a molten world's lava shows through. */
  lavaLevel: number;
  moltenFullK: number;
  moltenStartK: number;
  octaves: number;
  /** Relief height in planet radii per unit of surface height (0 = flat shading). */
  relief: number;
  seaLevel: number;
  shallowColor: string;
}

/** Per-planet inputs the rocky shader takes, derived from physical data. */
export interface RockyRegime {
  /** |latitude| where ice caps start; > 1 means no caps. */
  capStart: number;
  /** Crater strength (1 airless, `craterAtmosphereFactor` with an atmosphere). */
  craters: number;
  high: [number, number, number];
  low: [number, number, number];
  /** 0 (solid) → 1 (fully molten), driving lava glow. */
  molten: number;
  ocean: boolean;
  seed: number;
  surfaceTempK: number;
}

/** Parse `#rrggbb` to raw sRGB components in [0, 1]. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 0xFF) / 255, ((value >> 8) & 0xFF) / 255, (value & 0xFF) / 255];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function lerpRgb(a: string, b: string, t: number): [number, number, number] {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
}

/** Land colours at `tempK`, interpolated between the surrounding anchors (clamped at the ends). */
export function rockPalette(tempK: number, anchors: readonly PaletteAnchor[]): { high: [number, number, number]; low: [number, number, number] } {
  const first = anchors[0];
  if (!first)
    return { high: [0.5, 0.5, 0.5], low: [0.3, 0.3, 0.3] };
  let lower = first;
  let upper = first;
  for (const anchor of anchors) {
    if (anchor.tempK <= tempK)
      lower = anchor;
    if (anchor.tempK >= tempK) {
      upper = anchor;
      break;
    }
    upper = anchor;
  }
  const span = upper.tempK - lower.tempK;
  const t = span > 0 ? (tempK - lower.tempK) / span : 0;
  return { high: lerpRgb(lower.high, upper.high, t), low: lerpRgb(lower.low, upper.low, t) };
}

/**
 * The rocky shader's per-planet inputs: land colours, caps, lava and oceans from
 * the greenhouse-corrected surface temperature and water state; craters softened
 * where an atmosphere erodes them. Pure data → no new RNG draws.
 */
export function rockyRegime(planet: PlanetPhysical, tuning: RockyTuning): RockyRegime {
  const hasAtmosphere = atmosphereKind(planet) !== null;
  const surfaceTempK = surfaceTemperature(planet.equilibriumTemp, planet.type, hasAtmosphere);
  const warmth = Math.min(Math.max((surfaceTempK - tuning.capColdK) / (tuning.capWarmK - tuning.capColdK), 0), 1);
  const molten = smoothstep(tuning.moltenStartK, tuning.moltenFullK, surfaceTempK);
  return {
    ...rockPalette(surfaceTempK, tuning.anchors),
    capStart: surfaceTempK >= tuning.capWarmK ? 2 : tuning.capColdStart + (1 - tuning.capColdStart) * warmth,
    craters: hasAtmosphere ? tuning.craterAtmosphereFactor : 1,
    molten,
    ocean: planet.waterState === 'liquid' && molten === 0,
    seed: planetVarietySeed(planet),
    surfaceTempK,
  };
}

/** Look knobs for moon surfaces: airless rocky or icy bodies (tuned in the planet lab). */
export interface MoonTuning {
  continentScale: number;
  craterDensity: number;
  craterDepth: number;
  iceHigh: string;
  iceLow: string;
  /** Warmest host temperature at which a low-density moon keeps its ice. */
  iceStableK: number;
  /** Moons below this bulk density (g/cm³) are icy (when cold enough). */
  icyDensity: number;
  rockHigh: string;
  rockLow: string;
}

/** Whether a moon reads as icy: low bulk density and cold enough to keep its ice. */
export function isIcyMoon(moon: Pick<MoonPhysical, 'density'>, hostTempK: number, tuning: MoonTuning): boolean {
  return moon.density < tuning.icyDensity && hostTempK < tuning.iceStableK;
}

/**
 * Rocky-shader inputs for a moon: an airless body at its host planet's
 * temperature — grey regolith or ice by density, full craters, no oceans or
 * caps, lava only if roasting. Moon knobs override the matching rocky ones.
 */
export function moonSurface(moon: MoonPhysical, hostTempK: number, rocky: RockyTuning, tuning: MoonTuning): { regime: RockyRegime; tuning: RockyTuning } {
  const icy = isIcyMoon(moon, hostTempK, tuning);
  return {
    tuning: { ...rocky, continentScale: tuning.continentScale, craterDensity: tuning.craterDensity, craterDepth: tuning.craterDepth },
    regime: {
      capStart: 2,
      craters: 1,
      high: hexToRgb(icy ? tuning.iceHigh : tuning.rockHigh),
      low: hexToRgb(icy ? tuning.iceLow : tuning.rockLow),
      molten: smoothstep(rocky.moltenStartK, rocky.moltenFullK, hostTempK),
      ocean: false,
      seed: varietySeed([moon.mass, moon.radius, moon.density]),
      surfaceTempK: hostTempK,
    },
  };
}

/** Atmosphere families that form a cloud layer on rocky worlds (giants' clouds are their surface). */
export type CloudKind = Extract<AtmosphereKind, 'co2-runaway' | 'n2-co2' | 'thin-n2'>;

export const CLOUD_KINDS: readonly CloudKind[] = ['co2-runaway', 'n2-co2', 'thin-n2'];

/** How one family's cloud layer looks (tuned in the planet lab). */
export interface CloudLook {
  color: string;
  /** Fraction of the sky covered by cloud (0..1). */
  coverage: number;
  /** Uniform veil under the cloud pattern (0..1); near 1 = total overcast. */
  haze: number;
  /** Cloud pattern frequency: larger = smaller cloud systems. */
  scale: number;
  /** Cloud edge softness. */
  softness: number;
  /** Latitude compression: > 1 stretches clouds east–west, like zonal winds. */
  stretch: number;
  /** Domain-warp strength: swirl of the cloud systems. */
  swirl: number;
}

/** The planet's cloud family, or null (airless, giant, or a family without clouds). */
export function cloudKind(planet: PlanetPhysical): CloudKind | null {
  if (!isRockyType(planet.type))
    return null;
  const kind = atmosphereKind(planet);
  return kind !== null && (CLOUD_KINDS as readonly string[]).includes(kind) ? kind as CloudKind : null;
}
