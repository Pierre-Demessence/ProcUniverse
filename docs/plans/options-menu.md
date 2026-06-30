# Options menu & unit settings

A settings menu for display preferences, persisted across reloads and applied
live. Built in phases; this plan covers the whole feature, with Phase 1 detailed.

## Design decisions (from Pierre)

- A dedicated **options menu** (not per-value clicks).
- **Temperature:** K / °C / °F, chosen in the menu (replaces the inspector's
  click-to-toggle).
- **Distance:** Adaptive / km / AU / ly, applied **globally** (scale bar,
  coordinate readout, and inspector), with automatic scientific notation when a
  fixed unit gets unwieldy.
- **Relative vs Absolute:** a global toggle flipping "vs Sun/Earth" values to SI.
- **Extras:** Basic / Advanced inspector detail; Reset to defaults; Number
  notation (Auto / Scientific).

## Architecture

- `persistence/preferences.ts` → a generic versioned key/value store
  (`loadPreferences`, `savePreference`, `clearPreferences`).
- `ui/settings.ts` → typed, signal-backed settings on top of that store: a signal
  per setting, a setter that persists, and `resetSettings()`. The inspector reads
  these signals, so changes re-render it live (the mechanism the temperature
  toggle already used).
- `ui/options.tsx` → a top-centre gear toggle + drop-down panel of controls.
- `main.ts` wires `createOptionsMenu(container)` and disposes it.

## Phases

1. **Menu + temperature (this phase).** Options menu infra + temperature K/°C/°F
   + reset-to-defaults. Inspector temperature rows become display-only.
2. **Global distance unit.** One `formatDistance(au, unit)` used by the scale
   bar, coordinate readout, and inspector; Adaptive/km/AU/ly + sci-notation
   fallback. Unifies the two duplicated distance formatters.
3. **Relative vs Absolute (SI).** Absolute formatters for mass (kg), radius (km),
   luminosity (W), gravity (m/s²), insolation (W/m²), etc.
4. **Extras.** Basic/Advanced inspector detail; number notation Auto/Scientific.

## Phase 1 subtasks

- [x] `preferences.ts`: generic `loadPreferences` / `savePreference` / `clearPreferences`.
- [x] `ui/settings.ts`: `TemperatureUnit` (`C|F|K`), `temperatureUnit` signal,
  `setTemperatureUnit`, `resetSettings`.
- [x] `ui/options.tsx`: `createOptionsMenu` (top-centre gear + panel: temperature
  segmented control + Reset to defaults).
- [x] `inspector.tsx`: read `temperatureUnit` from settings; add °F to
  `formatTemperature`; temperature rows display-only; drop "Click to switch".
- [x] `main.ts`: mount + dispose the options menu.
- [x] Tests: move the temperature-unit test to `settings.test.ts`; add °F cases.
- [x] Static pipeline green + peer review.
