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
