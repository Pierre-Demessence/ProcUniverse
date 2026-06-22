# Plan — Phase F: Inspector overlay

Click a body to read its seed-derived physics. Realistic-sim Phases A–D produce
rich `StarPhysical` / `PlanetPhysical` data that is currently invisible — the
inspector surfaces it. Spec: [realistic-simulation.md](realistic-simulation.md)
Phase F.

## Requirements (EARS)

- WHEN the user clicks within the pick tolerance of a star or planet at the
  system tier, THE SYSTEM SHALL pin an inspector panel showing that body's
  derived physical properties.
- WHEN the user clicks empty space or presses Escape, THE SYSTEM SHALL dismiss
  the panel and clear the selection.
- WHILE a body is selected, THE SYSTEM SHALL draw a four-arrow reticle around it
  that tracks the body's current screen position (so it follows an orbiting
  planet).
- IF the selected entity streams out (the camera pans away or the tier changes),
  THEN THE SYSTEM SHALL clear the selection and hide the panel.
- THE SYSTEM SHALL read seed-stable data from `StarPhysical` / `PlanetPhysical`
  / `OrbitElements` and never display per-frame-varying physics.

## Design

- **Pick (`src/pick.ts`)** — `pickBodyAt(world, localCam, bx, by)`: map the
  cursor (backing px) to local world with `viewToWorld(bx, by, localCam)` (entity
  positions are stored origin-relative, matching `localCam`). Scan the
  `StarPhysicalDef` and `PlanetPhysicalDef` stores, read each `PositionDef`, and
  return the nearest body whose centre is within `max(discRadius, PICK_PX/zoom)`
  as `{ id, kind: 'star' | 'planet' } | null`.
- **Click vs drag** — the camera controller owns drag-pan. The inspector adds its
  own `pointerdown`/`pointerup` listeners and treats the gesture as a pick only
  when the pointer moved less than a small slop threshold (a real drag is
  ignored). Escape clears the selection.
- **Selection state** — held in `main.ts` as `{ id, kind } | null`. Each frame:
  if the entity is still alive, draw the reticle at its current position and
  refresh the panel; if it was destroyed (streamed out / tier change), clear.
- **Reticle (`src/render/select-reticle.ts`)** — `drawSelectReticle(ctx2d, sx,
  sy, discPx)`: four red arrowheads at the cardinal points around `(sx, sy)`,
  each pointing inward, at radius `max(discPx + GAP, MIN_RADIUS)` so tiny discs
  still get a clear, legible lock. Drawn in screen space each frame from the
  body's projected position (`worldToView(localPos, localCam)`).
- **Panel (`src/ui/inspector.ts`)** — an HTML overlay (same pattern as
  `time-controls.ts`), anchored bottom-right (TL=stats, TR=time, BL=hint+scale).
  `createInspector(container) → { update(world, selection), dispose }`. Hidden
  when nothing is selected. Field layouts:
  - **Star**: spectral class + colour swatch · mass (M☉) · luminosity (L☉) ·
    radius (R☉) · temperature (K) · main-sequence lifetime.
  - **Planet**: type · mass (M⊕) · radius (R⊕) · density (g/cm³) · equilibrium
    temp (K) · habitable? (`inHabitableZone` + `waterState`) · orbit a (AU) / e.
- **Scope (v1)** — system tier only (stars and planets exist as entities there).
  Zoomed-out tiers carry no entities, so picking is deferred (Phase G extends the
  inspector to galaxies / black holes).
- **Config** — `PICK_PX` (pick tolerance in screen px). Reticle sizing stays as
  module constants unless tuning warrants promotion.

## Tasks

- [x] Config: `PICK_PX` pick tolerance.
- [x] `src/pick.ts` — `pickBodyAt` (nearest star/planet within tolerance).
- [x] `src/render/select-reticle.ts` — four-arrow reticle that tracks the body.
- [x] `src/ui/inspector.ts` — HTML data panel (star + planet layouts).
- [x] `main.ts` wiring — drag-safe click pick, Escape dismiss, per-frame reticle
      + panel update, clear-on-despawn / tier change.
- [x] Unit tests: `pickBodyAt` nearest-within-tolerance; value formatting.
- [x] Docs: `features.md` (+ `codebase.md` if a new dir appears).
- [x] Static pipeline green (`npm run build`, `npm test`, `npm run lint`).
- [x] Lightweight peer review.
- [ ] Hand off in-browser E2E (click a star and a planet) to Pierre.
