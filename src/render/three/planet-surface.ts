/**
 * Pure, data-driven helpers for procedural planet surfaces (see
 * docs/plans/planet-surfaces.md). Kept free of any Three.js / TSL import so they
 * are cheap to unit test; the TSL side (`planet-material.ts`,
 * `surface-bake.ts`) mirrors the maths here.
 */

import type { PlanetPhysical } from '../../generation/planets';

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
