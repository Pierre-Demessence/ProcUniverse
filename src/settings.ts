/**
 * Typed, signal-backed display settings on top of the preferences store. Each
 * setting is a signal seeded from storage; its setter updates the signal and
 * persists. Read by both the HUD UI (inspector, options menu) and the canvas
 * renderer (scale bar, coordinate readout), so it lives at the app level. A
 * change re-renders just the parts that read it. New settings are added here as
 * the options menu grows.
 */

import type { DistanceUnit } from './distance';

import { signal } from '@preact/signals';

import { clearPreferences, loadPreferences, savePreference } from './persistence/preferences';

/** Display unit for temperatures: kelvin, degrees Celsius, or degrees Fahrenheit. */
export type TemperatureUnit = 'C' | 'F' | 'K';

/** Whether "vs Sun/Earth" quantities show relative (☉/⊕) or absolute (SI) units. */
export type ValueMode = 'absolute' | 'relative';

const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'K';
const DEFAULT_DISTANCE_UNIT: DistanceUnit = 'adaptive';
const DEFAULT_VALUE_MODE: ValueMode = 'relative';

function asTemperatureUnit(value: unknown): TemperatureUnit | null {
  return value === 'C' || value === 'F' || value === 'K' ? value : null;
}

function asDistanceUnit(value: unknown): DistanceUnit | null {
  return value === 'adaptive' || value === 'au' || value === 'km' || value === 'ly' ? value : null;
}

function asValueMode(value: unknown): ValueMode | null {
  return value === 'absolute' || value === 'relative' ? value : null;
}

const stored = loadPreferences();

/** The temperature unit every panel renders, seeded from storage. */
export const temperatureUnit = signal<TemperatureUnit>(asTemperatureUnit(stored.temperatureUnit) ?? DEFAULT_TEMPERATURE_UNIT);

/** The distance unit the scale bar, coordinates, and inspector render, seeded from storage. */
export const distanceUnit = signal<DistanceUnit>(asDistanceUnit(stored.distanceUnit) ?? DEFAULT_DISTANCE_UNIT);

/** Whether the inspector shows quantities relative to the Sun/Earth or in absolute SI units. */
export const valueMode = signal<ValueMode>(asValueMode(stored.valueMode) ?? DEFAULT_VALUE_MODE);

/** Choose the temperature unit and persist it. */
export function setTemperatureUnit(unit: TemperatureUnit): void {
  temperatureUnit.value = unit;
  savePreference('temperatureUnit', unit);
}

/** Choose the distance unit and persist it. */
export function setDistanceUnit(unit: DistanceUnit): void {
  distanceUnit.value = unit;
  savePreference('distanceUnit', unit);
}

/** Choose relative or absolute values and persist it. */
export function setValueMode(mode: ValueMode): void {
  valueMode.value = mode;
  savePreference('valueMode', mode);
}

/** Restore every setting to its default and clear the stored preferences. */
export function resetSettings(): void {
  temperatureUnit.value = DEFAULT_TEMPERATURE_UNIT;
  distanceUnit.value = DEFAULT_DISTANCE_UNIT;
  valueMode.value = DEFAULT_VALUE_MODE;
  clearPreferences();
}
