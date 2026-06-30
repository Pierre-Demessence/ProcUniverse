/**
 * Typed, signal-backed display settings on top of the preferences store. Each
 * setting is a signal seeded from storage; its setter updates the signal and
 * persists. UI (the inspector, the options menu) reads the signals, so a change
 * re-renders just the parts that use it. New settings are added here as the
 * options menu grows.
 */

import { signal } from '@preact/signals';

import { clearPreferences, loadPreferences, savePreference } from '../persistence/preferences';

/** Display unit for temperatures: kelvin, degrees Celsius, or degrees Fahrenheit. */
export type TemperatureUnit = 'C' | 'F' | 'K';

const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'K';

function asTemperatureUnit(value: unknown): TemperatureUnit | null {
  return value === 'C' || value === 'F' || value === 'K' ? value : null;
}

const stored = loadPreferences();

/** The temperature unit every panel renders, seeded from storage. */
export const temperatureUnit = signal<TemperatureUnit>(asTemperatureUnit(stored.temperatureUnit) ?? DEFAULT_TEMPERATURE_UNIT);

/** Choose the temperature unit and persist it. */
export function setTemperatureUnit(unit: TemperatureUnit): void {
  temperatureUnit.value = unit;
  savePreference('temperatureUnit', unit);
}

/** Restore every setting to its default and clear the stored preferences. */
export function resetSettings(): void {
  temperatureUnit.value = DEFAULT_TEMPERATURE_UNIT;
  clearPreferences();
}
