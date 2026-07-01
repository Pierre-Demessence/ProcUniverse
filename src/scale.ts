import { LY_PER_SECTOR } from './config';
import { AU_PER_LY, kmToAu, R_EARTH_KM, R_SUN_KM, SCHWARZSCHILD_AU_PER_SOLAR_MASS } from './generation/units';

/**
 * The world's spatial scale. The world unit is the **astronomical unit (AU)**:
 * planet orbits are a few-to-tens of AU while stars are light-years apart, the
 * ~10⁵× ratio that makes space feel real (research §2.1). `LY_PER_SECTOR` (in
 * `config.ts`) sets the sector size; this module derives the world scale and the
 * drawn radius of each body.
 *
 * Bodies are drawn at their **true physical radius** (a star is a rounding error
 * at AU scale — the Sun is ~0.005 AU), so a framed system shows tiny, near-
 * invisible bodies. That is the honest baseline; a zoom-aware apparent-size morph
 * (Phase 4, see docs/plans/system-scale-realism.md) will make it usable without
 * lying about scale. The dormant `*_DISC_*` knobs in `config.ts` feed that morph.
 */

/** Sector edge length, in AU (the world unit), derived from `LY_PER_SECTOR`. */
export const SECTOR_SIZE = LY_PER_SECTOR * AU_PER_LY;

/** The Sun's and Earth's true physical radii in AU — the scale of a drawn body. */
const SUN_RADIUS_AU = kmToAu(R_SUN_KM);
const EARTH_RADIUS_AU = kmToAu(R_EARTH_KM);

/** Drawn star radius (AU) — the star's true physical radius (R☉ → AU). */
export function starVisualRadius(radiusSolar: number): number {
  return radiusSolar * SUN_RADIUS_AU;
}

/** Drawn planet radius (AU) — the planet's true physical radius (R⊕ → AU). */
export function planetVisualRadius(radiusEarth: number): number {
  return radiusEarth * EARTH_RADIUS_AU;
}

/** Drawn black-hole radius (AU) — the true Schwarzschild radius `r_s = 2GM/c²`. */
export function blackHoleVisualRadius(massSolar: number): number {
  return massSolar * SCHWARZSCHILD_AU_PER_SOLAR_MASS;
}
