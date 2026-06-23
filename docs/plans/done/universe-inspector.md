# Clickable Universe node (Universe inspector)

Follow-up to the location tree (Pierre: "make the Universe node clickable
too"). Today the Universe node is the only non-clickable tree node because no
universe-level inspector panel exists. Add one.

## Approach

- New selection kind `UniversePick { kind: 'universe', seed }` in the `Selection`
  union (carries the seed; no entity, like `GalaxyPick` carries its galaxy).
- `UniversePanel` in the inspector showing honest, seed-derived universe facts:
  **Seed** (hex identity), **Age** (`universeAge(seed)`), **Home galaxy**
  (`galaxyAt(seed, 0, 0)` — the galaxy at the world origin you start in).
- Tree: make the Universe node `selectable: true`.
- `main.ts`: `onSelect` universe → `{ kind: 'universe', seed }`; `selectionKey`
  → `'universe'` (matches the node key, so it highlights); the render-loop
  selection-tracking persists a universe selection (no entity, no reticle).
- A universe selection persists across all tiers (it is always valid) and is
  dismissed by Escape or an empty-canvas click, like the others.

## Tasks

- [x] `pick.ts`: add `UniversePick` to `Selection`.
- [x] `inspector.tsx`: `UniversePanel` + `formatSeed`; wire into `InspectorPanel`.
- [x] `nav-tree.tsx`: Universe node `selectable: true`; update the two
      selectable assertions in the test.
- [x] `main.ts`: universe branches in `onSelect`, `selectionKey`, and the
      selection-tracking block.
- [x] Tests: `formatSeed`; updated nav-tree selectable expectations.
- [x] Docs: refresh the `features.md` location-tree row (all nodes clickable).
- [x] Static pipeline green + peer review.
