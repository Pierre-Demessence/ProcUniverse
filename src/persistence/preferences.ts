/**
 * Persists display preferences that should outlive a seed reset (currently the
 * inspector's temperature unit) as a single versioned `localStorage` object,
 * kept apart from the universe save and its checksummed seed backend. A
 * read-modify-write preserves any other preference fields when one changes.
 */

const PREFERENCES_KEY = 'procuniverse:preferences';
const PREFERENCES_VERSION = 1;

// The display unit for temperatures: absolute kelvin or degrees Celsius. Owned
// here (a leaf layer) so the persistence API and the inspector share one type
// without the UI being a dependency of storage.
export type TemperatureUnit = 'C' | 'K';

/** The stored preferences object, or `{}` if unset, corrupt, or unavailable. */
function readPreferences(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw !== null) {
      const value = JSON.parse(raw);
      if (typeof value === 'object' && value !== null)
        return value as Record<string, unknown>;
    }
  }
  catch {
    // Unavailable or corrupt — treated as empty.
  }
  return {};
}

/** Read the saved temperature unit, or null if unset or storage is unavailable. */
export function loadTemperatureUnit(): TemperatureUnit | null {
  const unit = readPreferences().temperatureUnit;
  return unit === 'C' || unit === 'K' ? unit : null;
}

/** Persist the temperature unit, keeping other preferences; failures are ignored. */
export function saveTemperatureUnit(unit: TemperatureUnit): void {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...readPreferences(), temperatureUnit: unit, version: PREFERENCES_VERSION }),
    );
  }
  catch {
    // Best-effort persistence.
  }
}
