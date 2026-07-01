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

/** How much detail the inspector shows: a friendly subset, or every property. */
export type DetailLevel = 'advanced' | 'basic';

/** How numbers render: friendly (grouped, sci only at the extremes) or always scientific. */
export type NumberNotation = 'auto' | 'scientific';

/** Body sizes: true physical scale (honest, tiny when zoomed out) or floored so bodies stay visible. */
export type BodyScale = 'true' | 'usable';

const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'K';
const DEFAULT_DISTANCE_UNIT: DistanceUnit = 'adaptive';
const DEFAULT_VALUE_MODE: ValueMode = 'relative';
const DEFAULT_DETAIL_LEVEL: DetailLevel = 'advanced';
const DEFAULT_NUMBER_NOTATION: NumberNotation = 'auto';
const DEFAULT_BODY_SCALE: BodyScale = 'usable';

function asTemperatureUnit(value: unknown): TemperatureUnit | null {
  return value === 'C' || value === 'F' || value === 'K' ? value : null;
}

function asDistanceUnit(value: unknown): DistanceUnit | null {
  return value === 'adaptive' || value === 'au' || value === 'km' || value === 'ly' ? value : null;
}

function asValueMode(value: unknown): ValueMode | null {
  return value === 'absolute' || value === 'relative' ? value : null;
}

function asDetailLevel(value: unknown): DetailLevel | null {
  return value === 'advanced' || value === 'basic' ? value : null;
}

function asNumberNotation(value: unknown): NumberNotation | null {
  return value === 'auto' || value === 'scientific' ? value : null;
}

function asBodyScale(value: unknown): BodyScale | null {
  return value === 'true' || value === 'usable' ? value : null;
}

const stored = loadPreferences();

/** The temperature unit every panel renders, seeded from storage. */
export const temperatureUnit = signal<TemperatureUnit>(asTemperatureUnit(stored.temperatureUnit) ?? DEFAULT_TEMPERATURE_UNIT);

/** The distance unit the scale bar, coordinates, and inspector render, seeded from storage. */
export const distanceUnit = signal<DistanceUnit>(asDistanceUnit(stored.distanceUnit) ?? DEFAULT_DISTANCE_UNIT);

/** Whether the inspector shows quantities relative to the Sun/Earth or in absolute SI units. */
export const valueMode = signal<ValueMode>(asValueMode(stored.valueMode) ?? DEFAULT_VALUE_MODE);

/** How many inspector rows to show: a friendly subset (basic) or every property (advanced). */
export const detailLevel = signal<DetailLevel>(asDetailLevel(stored.detailLevel) ?? DEFAULT_DETAIL_LEVEL);

/** How numbers render across the inspector and HUD: friendly or always scientific. */
export const numberNotation = signal<NumberNotation>(asNumberNotation(stored.numberNotation) ?? DEFAULT_NUMBER_NOTATION);

/** Whether bodies draw at true physical scale or floored to stay visible when zoomed out. */
export const bodyScale = signal<BodyScale>(asBodyScale(stored.bodyScale) ?? DEFAULT_BODY_SCALE);

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

/** Choose the inspector detail level and persist it. */
export function setDetailLevel(level: DetailLevel): void {
  detailLevel.value = level;
  savePreference('detailLevel', level);
}

/** Choose the number notation and persist it. */
export function setNumberNotation(notation: NumberNotation): void {
  numberNotation.value = notation;
  savePreference('numberNotation', notation);
}

/** Choose true or usable body scale and persist it. */
export function setBodyScale(scale: BodyScale): void {
  bodyScale.value = scale;
  savePreference('bodyScale', scale);
}

/** Restore every setting to its default and clear the stored preferences. */
export function resetSettings(): void {
  temperatureUnit.value = DEFAULT_TEMPERATURE_UNIT;
  distanceUnit.value = DEFAULT_DISTANCE_UNIT;
  valueMode.value = DEFAULT_VALUE_MODE;
  detailLevel.value = DEFAULT_DETAIL_LEVEL;
  numberNotation.value = DEFAULT_NUMBER_NOTATION;
  bodyScale.value = DEFAULT_BODY_SCALE;
  clearPreferences();
}
