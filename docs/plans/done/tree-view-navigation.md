# Tree-view navigation hierarchy

Source: `TODO.md` → "Add 'tree view' navigation hierarchy".

A top-left panel that shows the viewer's **current location** as a hierarchy
(Universe → Galaxy → System → Planet) derived from the camera, growing as you
zoom in. Each node is **clickable to open the inspector** for that body.

## Decisions (from Pierre)

- **Passive, camera-driven** readout — it reflects where the camera is, not a
  separate navigation control. (Auto-zoom / return-to-origin are separate TODO
  items.)
- **Clickable nodes**: clicking a node sets the inspector selection for that
  body (galaxy / star / planet). The Universe node is non-clickable for now
  ("for those that support it; ultimately all should" — a Universe inspector
  panel is a later follow-up).
- **Flat hierarchy**: Universe → Galaxy → System → Planet. No sub-galaxy
  regions (core/disk/arm/halo) in v1.
- **Placement**: tree top-left; **move the perf monitor to top-right, just left
  of the sim-time panel** (frees the top-left corner).
- Moons aren't generated yet (separate TODO) — the hierarchy stops at Planet.

## Behaviour

- **Only show nodes relevant to the current tier** (in → out):
  - `universe`: Universe only.
  - `galaxy-field` / `galaxy` / `star`: Universe → Galaxy (Galaxy shown only
    when the camera sits inside a galaxy's footprint; void = Universe only).
  - `system`: Universe → Galaxy → System → Planet×N.
- The **System + Planet** nodes appear only at the `system` tier (where those
  entities are streamed) — this satisfies "hide the star node until zoomed into
  a system".
- The focused system is the one **nearest the camera** in its sector (the same
  `nearestStar` the floating render origin already uses).
- The node matching the current inspector selection is **highlighted**.

## Click → selection mapping

- **Galaxy node** → `{ galaxy: galaxyAt(seed, camX, camY), kind: 'galaxy' }`.
  Galaxy selections must persist across tiers (today `main.ts` clears them when
  leaving `galaxy-field`); only the on-canvas reticle stays tier-gated.
- **System (star) node** → resolve the streamed entity by its unique
  `NameDef.name` → `{ id, kind: 'star' }`.
- **Planet node** → resolve by name → `{ id, kind: 'planet' }`.
- Resolution happens on click (not per frame): `findEntityByName(world, name)`.

## Tasks

- [x] `config.ts`: stats-overlay placement knobs (top / right reserve / width /
      gap, CSS px) + tree indent px.
- [x] `pick.ts`: `findEntityByName(world, name): EntityId | null`.
- [x] `ui/nav-tree.tsx`: `createNavTree(container, { onSelect })` + pure,
      testable `navNodes(state)` and `navSignature(state)` (per-frame dedupe so
      the panel only re-renders when the location/selection changes).
- [x] `main.ts`: create the tree; assemble `NavState` each frame; wire
      `onSelect`; reposition `drawStatsOverlay` to top-right (left of sim panel);
      relax galaxy-selection clearing so tree-selected galaxies persist;
      generalise `nearestStar` to return the focused `SystemData`.
- [x] Tests: `navNodes` (per-tier node sets, depth, selectable), `navSignature`
      (dedupe), `findEntityByName`.
- [x] Docs: `features.md` (new row), `codebase.md` (nav-tree note), tick the
      `TODO.md` item.
- [x] Static pipeline green (`npm run build`, `npm test`) + peer review.

## Out of scope (deferred)

- Sub-galaxy region nodes (core/disk/arm/halo).
- A Universe inspector panel (would make the Universe node clickable).
- Click-to-zoom navigation (covered by the separate auto-zoom TODO items).
- Moons (separate TODO).
