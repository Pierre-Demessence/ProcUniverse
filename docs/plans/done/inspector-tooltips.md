# Inspector property tooltips

Add a one-sentence, plain-language explanation to every property row in the
body inspector, so non-astronomers understand each value.

## Design decisions (from Pierre)

- **Mechanism:** a custom HUD-styled popover (not the native `title`), appearing
  instantly on hover.
- **Coverage:** every property row, including otherwise-obvious ones.
- **Wording:** a single plain-language sentence each.
- **Discoverability:** a `cursor: help` on hover only (no underline cue).

## Requirements (EARS)

- WHEN the pointer hovers a property row, THE SYSTEM SHALL show a styled popover
  with a one-sentence explanation of that property.
- WHEN the pointer leaves the row, THE SYSTEM SHALL hide the popover.
- WHERE a row is also interactive (the temperature rows toggle K/°C), THE SYSTEM
  SHALL keep its click behaviour and use a pointer cursor.

## Design

- A `useHover()` hook (`preact/hooks` `useState`) returns `{ hovered }` plus
  `onMouseEnter` / `onMouseLeave` to bind to a row.
- `TOOLTIP_CSS`: an absolutely-positioned popover anchored to the LEFT of the row
  (`right: calc(100% + 10px)`, vertically centred) so it stays on-screen — the
  panel is pinned bottom-right with no overflow clipping. More opaque than the
  panel, wraps within a fixed width, `pointer-events: none`.
- `Row` gains a required `tooltip` prop (TypeScript then enforces that every row
  supplies one) and renders the popover when hovered, with `cursor: help`.
- `TemperatureRow` keeps its `onClick` + pointer cursor and also shows a popover.
- The star "Class" swatch row becomes a small `ClassRow` using the same hook.

## Subtasks

- [x] `useHover` hook + `TOOLTIP_CSS`; import `useState`.
- [x] `Row` + `TemperatureRow` render the popover; extract `ClassRow`.
- [x] Tooltip text for every Star row (16).
- [x] Tooltip text for every Planet row (23).
- [x] Tooltip text for every Black-hole row (10).
- [x] Tooltip text for every Galaxy (8) and Universe (3) row.
- [x] Static pipeline green (build / test / lint) + peer review.
