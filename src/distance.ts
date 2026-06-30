/**
 * Distance display units and formatting, shared by the scale bar, the
 * coordinate readout, and the inspector so a single setting governs every
 * distance shown. `adaptive` auto-selects a friendly unit by magnitude (the only
 * sane default across the ~20 orders of magnitude from a planet's surface to
 * intergalactic space); the fixed units fall back to compact scientific notation
 * when the number gets unwieldy. All inputs are astronomical units (the world
 * unit); the user's choice lives in `settings.ts`.
 */

import { SCALE_KM_BELOW_AU, SCALE_LY_ABOVE_AU } from './config';
import { auToKm, auToLy, kmToAu, lyToAu } from './generation/units';

export type DistanceUnit = 'adaptive' | 'au' | 'km' | 'ly';

/** A concrete distance unit (everything but `adaptive`). */
export type FixedDistanceUnit = Exclude<DistanceUnit, 'adaptive'>;

const UNIT_LABELS: Record<FixedDistanceUnit, string> = { au: 'AU', km: 'km', ly: 'ly' };

// A fixed-unit value outside this readable band switches to scientific notation.
const SCI_HIGH = 1e6;
const SCI_LOW = 1e-3;

/** Three significant figures with thousands separators, trailing zeros dropped. */
function threeSigFigs(value: number): string {
  return Number(value.toPrecision(3)).toLocaleString('en-US');
}

/** Three sig figs, switching to compact scientific notation (`1.50e8`) at the extremes. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (value !== 0 && (abs >= SCI_HIGH || abs < SCI_LOW))
    return value.toExponential(2).replace('e+', 'e');
  return threeSigFigs(value);
}

/** Convert an AU distance to the given fixed unit. */
export function auToUnit(au: number, unit: FixedDistanceUnit): number {
  if (unit === 'km')
    return auToKm(au);
  if (unit === 'ly')
    return auToLy(au);
  return au;
}

/** Convert a value in the given fixed unit back to AU. */
export function unitToAu(value: number, unit: FixedDistanceUnit): number {
  if (unit === 'km')
    return kmToAu(value);
  if (unit === 'ly')
    return lyToAu(value);
  return value;
}

/** A signed AU distance auto-scaled to km / Mkm / AU / ly / kly / Mly by magnitude. */
function formatAdaptive(au: number): string {
  const absAu = Math.abs(au);
  if (absAu < SCALE_KM_BELOW_AU) {
    const km = auToKm(au);
    return Math.abs(km) >= 1e6 ? `${threeSigFigs(km / 1e6)} Mkm` : `${threeSigFigs(km)} km`;
  }
  if (absAu < SCALE_LY_ABOVE_AU)
    return `${threeSigFigs(au)} AU`;
  const ly = auToLy(au);
  const absLy = Math.abs(ly);
  if (absLy < 1e3)
    return `${threeSigFigs(ly)} ly`;
  if (absLy < 1e6)
    return `${threeSigFigs(ly / 1e3)} kly`;
  return `${threeSigFigs(ly / 1e6)} Mly`;
}

/** Format an AU distance in the chosen unit, or auto-scaled when adaptive. */
export function formatDistance(au: number, unit: DistanceUnit): string {
  if (unit === 'adaptive')
    return formatAdaptive(au);
  return `${compactNumber(auToUnit(au, unit))} ${UNIT_LABELS[unit]}`;
}
