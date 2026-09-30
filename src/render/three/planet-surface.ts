/**
 * Pure, data-driven helpers for procedural planet surfaces and atmospheres (see
 * docs/plans/planet-surfaces.md). Kept free of any Three.js / TSL import so they
 * are cheap to unit test; the TSL side (`planet-material.ts`, `surface-bake.ts`,
 * `atmosphere-material.ts`) mirrors the maths here.
 */

import type { PlanetPhysical } from '../../generation/planets';

import { atmosphereType, escapeVelocity, retainsAtmosphere } from '../../generation/planets';

/** Range of the per-planet noise offset returned by `planetVarietySeed`. */
export const VARIETY_SEED_RANGE = 1000;

const scratch = new DataView(new ArrayBuffer(8));

/**
 * A stable per-planet noise offset in `[0, VARIETY_SEED_RANGE)`, hashed from
 * already-generated physical values so two same-type planets look different
 * without a new RNG draw (the universe stays byte-identical).
 */
export function planetVarietySeed(planet: Pick<PlanetPhysical, 'equilibriumTemp' | 'mass' | 'radius' | 'rotationPeriod'>): number {
  // FNV-1a over the IEEE-754 bytes: every bit of each value contributes, so
  // planets differing only in a low decimal still get unrelated offsets.
  let h = 0x811C9DC5;
  for (const value of [planet.mass, planet.radius, planet.equilibriumTemp, planet.rotationPeriod]) {
    scratch.setFloat64(0, value);
    for (let i = 0; i < 8; i++) {
      h ^= scratch.getUint8(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return ((h >>> 0) / 0x100000000) * VARIETY_SEED_RANGE;
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
