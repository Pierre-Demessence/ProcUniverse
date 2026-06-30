# Persist session & preferences across reloads

Remember the viewer's place in the universe between sessions, and their display
preferences independently of any particular universe. Unifies what were three
ad-hoc `localStorage` keys into two purpose-built, versioned objects.

## Requirements (EARS)

- WHEN the app starts and a valid save exists, THE SYSTEM SHALL restore the
  world seed, camera view, sim clock, and speed.
- WHEN the app starts and no save exists, THE SYSTEM SHALL mint a new universe
  and frame the origin.
- WHEN the page unloads, THE SYSTEM SHALL persist the seed, camera view, sim
  clock, and speed together.
- WHEN the viewer clicks "Return to origin", THE SYSTEM SHALL reframe the home
  galaxy.
- WHEN the app starts, THE SYSTEM SHALL restore the temperature unit, defaulting
  to kelvin; WHEN the viewer toggles it, THE SYSTEM SHALL persist the choice.
- IF `localStorage` is unavailable, THEN THE SYSTEM SHALL fall back to defaults
  without blocking startup.

## Design

Two versioned `localStorage` objects with different lifetimes:

| Key | Holds | Lifetime |
| --- | --- | --- |
| `procuniverse:save` | `{ version, seed, view, simSeconds, speedIndex }` | tied to the universe — cleared ⇒ new universe |
| `procuniverse:preferences` | `{ version, temperatureUnit }` | survives a seed reset |

- The view's coordinates only mean anything for one seed, so they live *with* the
  seed and reset as a unit; preferences are seed-independent.
- Plain synchronous `localStorage`: the save is written on unload, where awaiting
  an async storage backend would be unreliable. Validation simply defaults a
  missing or corrupt value.
- `start(container, save)` receives the whole save; the teardown (wired to
  `beforeunload`) writes it back. `parseSave` validates and fills defaults.

## Subtasks

- [x] `src/persistence/save.ts`: `Save`, `SavedView`, `parseSave`,
  `loadOrCreateSave` (mint on miss), `writeSave`.
- [x] `src/persistence/save.test.ts`: `parseSave` validation + defaults.
- [x] `src/persistence/preferences.ts`: versioned object, `load`/`saveTemperatureUnit`.
- [x] `src/ui/time-controls.tsx`: accept an initial speed index; expose the current one.
- [x] `src/ui/reset-view.ts`: `createResetViewButton`.
- [x] `src/main.ts`: `start(save)`, restore seed/view/clock/speed, persist on teardown.
- [x] `index.html`: `loadOrCreateSave` → `start(root, save)`.
- [x] Remove the absorbed `seed.ts` / `view.ts` / `view.test.ts`.
- [x] Docs: `features.md`, `codebase.md`, `TODO.md`.
- [x] Static pipeline green (build / test / lint) + peer review.
