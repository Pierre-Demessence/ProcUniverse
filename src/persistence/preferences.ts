/**
 * A small versioned key/value store in `localStorage` for display preferences
 * that should outlive a seed reset, kept apart from the universe save and its
 * checksummed seed backend. A read-modify-write preserves the other keys when
 * one changes; the typed, signal-backed settings live in `ui/settings.ts`.
 */

const PREFERENCES_KEY = 'procuniverse:preferences';
const PREFERENCES_VERSION = 1;

/** The stored preferences object, or `{}` if unset, corrupt, or unavailable. */
export function loadPreferences(): Record<string, unknown> {
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

/** Persist one preference, keeping the others; storage failures are ignored. */
export function savePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ ...loadPreferences(), [key]: value, version: PREFERENCES_VERSION }),
    );
  }
  catch {
    // Best-effort persistence.
  }
}

/** Clear all stored preferences (used by reset-to-defaults). */
export function clearPreferences(): void {
  try {
    localStorage.removeItem(PREFERENCES_KEY);
  }
  catch {
    // Best-effort.
  }
}
