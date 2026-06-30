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

const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'K';
const DEFAULT_DISTANCE_UNIT: DistanceUnit = 'adaptive';

function asTemperatureUnit(value: unknown): TemperatureUnit | null {
  return value === 'C' || value === 'F' || value === 'K' ? value : null;
}

function asDistanceUnit(value: unknown): DistanceUnit | null {
  return value === 'adaptive' || value === 'au' || value === 'km' || value === 'ly' ? value : null;
}

const stored = loadPreferences();

/** The temperature unit every panel renders, seeded from storage. */
export const temperatureUnit = signal<TemperatureUnit>(asTemperatureUnit(stored.temperatureUnit) ?? DEFAULT_TEMPERATURE_UNIT);

/** The distance unit the scale bar, coordinates, and inspector render, seeded from storage. */
export const distanceUnit = signal<DistanceUnit>(asDistanceUnit(stored.distanceUnit) ?? DEFAULT_DISTANCE_UNIT);

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

/** Restore every setting to its default and clear the stored preferences. */
export function resetSettings(): void {
  temperatureUnit.value = DEFAULT_TEMPERATURE_UNIT;
  distanceUnit.value = DEFAULT_DISTANCE_UNIT;
  clearPreferences();
}
