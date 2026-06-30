/**
 * Physical constants and unit conversions for the realistic-simulation data
 * layer. Stellar and planetary properties are derived in **solar / Earth /
 * astronomical** units (M☉, R☉, L☉, AU, K, years) so the relations read like
 * the textbook formulas; SI constants are kept for the few places that need
 * them. Distances use two scales: AU within a system, light-years between
 * systems (one light-year ≈ 63,241 AU — the ~10⁵× ratio that makes space feel
 * real). Sources and exact values: docs/research/realistic-simulation.md §9.
 */

/** Stefan–Boltzmann constant σ, in W·m⁻²·K⁻⁴. */
export const STEFAN_BOLTZMANN = 5.670374419e-8;

/** The Sun's effective surface temperature T☉, in kelvin. */
export const T_SUN = 5772;

/** The Sun's bolometric luminosity L☉, in watts. */
export const L_SUN = 3.828e26;

/** Kilometres in one astronomical unit (Earth–Sun distance). */
export const KM_PER_AU = 1.495978707e8;

/** Astronomical units in one light-year. */
export const AU_PER_LY = 63241.077;

/** Seconds in one Julian year (365.25 days). */
export const SECONDS_PER_YEAR = 31557600;

/**
 * Schwarzschild radius per solar mass, in AU: `r_s = 2GM/c²`. The Sun's is
 * ~2.95 km, so a 4.3e6 M☉ SMBH (Sgr A*) is ~0.085 AU and a 6.5e9 M☉ one
 * (M87*) ~128 AU — tiny at galaxy scale, stored as data like any body radius.
 */
export const SCHWARZSCHILD_AU_PER_SOLAR_MASS = 1.9742e-8;

/** Mass of the Sun, in kilograms. */
export const M_SUN_KG = 1.98892e30;

/** Mass of the Earth, in kilograms. */
export const M_EARTH_KG = 5.9722e24;

/** Radius of the Sun, in kilometres. */
export const R_SUN_KM = 695700;

/** Mean radius of the Earth, in kilometres. */
export const R_EARTH_KM = 6371;

/** Standard gravitational acceleration at Earth's surface, in m/s². */
export const EARTH_GRAVITY_MS2 = 9.80665;

/** The solar constant: sunlight at Earth's distance, in W/m². */
export const SOLAR_CONSTANT_W_M2 = 1361;

/** Convert astronomical units to kilometres. */
export function auToKm(au: number): number {
  return au * KM_PER_AU;
}

/** Convert kilometres to astronomical units. */
export function kmToAu(km: number): number {
  return km / KM_PER_AU;
}

/** Convert light-years to astronomical units. */
export function lyToAu(ly: number): number {
  return ly * AU_PER_LY;
}

/** Convert astronomical units to light-years. */
export function auToLy(au: number): number {
  return au / AU_PER_LY;
}
