# Inspector: temperature unit toggle + orbital period

Two small additions to the body inspector.

## 1. Runtime temperature unit (K ⇄ °C)

- [x] A shared `temperatureUnit` signal (`'K' | 'C'`, default `K`) + `toggleTemperatureUnit()`.
- [x] `formatTemperature(kelvin, unit)` converts to °C when selected (`K − 273.15`), keeps the `K` / `°C` suffix.
- [x] A clickable `TemperatureRow` in the inspector toggles the unit at runtime; both the star
      temperature and planet equilibrium rows use it, so they stay in sync.

## 2. Orbital period in convenient units

- [x] `formatPeriod(years)` cascades to the largest human-readable unit:
      seconds → minutes (≥60 s) → hours (≥60 min) → days (≥24 h) → years (≥1 yr).
- [x] Show a `Period` row in the planet panel from `orbitalPeriod(starMass, a)`.

## Validation

- [x] Unit tests for `formatTemperature` (°C) and `formatPeriod` (each boundary).
- [x] Static pipeline green: `npm run lint`, `npm run build`, `npm test`.
- [x] Peer review pass (fast model, no edits).
- [x] Docs updated (features.md).
- [ ] Browser verification handed off to Pierre (per AGENTS.md).
