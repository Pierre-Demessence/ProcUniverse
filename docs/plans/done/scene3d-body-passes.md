# Scene3D body passes

Replace the hand-rolled, index-based mesh pools in `ThreeRenderer.render()`
(system tier) with engine `Scene3DRenderer` passes, and move body management
out of `three-renderer.ts` into its own module. Source of truth for the engine
surface: `@pierre/ecs/modules/render-scene3d` (including the optional `remove`
callback). Roadmap item: "Split `ThreeRenderer.render()`".

## Goals

- One `Scene3DRenderer` pass per kind of mesh; existence (create / remove) is
  owned by the engine, appearance by `sync`.
- GPU objects (meshes + their materials) are recycled through free-lists, so
  streaming bodies in and out neither leaks materials nor rebuilds shaders.
- `ThreeRenderer.render()` shrinks to camera setup, the star light, the pass
  calls and the final draw.

## Non-goals

- `Position3DDef`: bodies keep `PositionDef` + `PositionZDef` until Canvas 2D is
  retired ([engine-adoption.md](../../research/engine-adoption.md)).
- No visual change: appearance, picking (`userData.id` / `kind`), star light,
  star minimum screen size and the bloom pipeline behave as before.
- Instanced tiers (`renderStars`, `renderGalaxy`, ...) and `updateOrbitRings`
  are untouched.

## Design

### Module

`src/render/three/body-passes.ts` builds the passes and owns the free-lists.
`ThreeRenderer` constructs it with the shared `group`, `sphereGeometry` and
`planetRingGeometry`, and calls it from `render()`.

| Pass | Selects | Mesh from |
| ---- | ------- | --------- |
| stars | `StarPhysicalDef` with circle renderable + position | star-sphere free-list (own material handle) |
| planets | `PlanetPhysicalDef` with circle renderable + position | planet-sphere free-list (shared planet material handle) |
| moons | `MoonPhysicalDef` with circle renderable + position | generic lit-sphere free-list |
| black holes | `BlackHoleDef` with circle renderable + position | generic lit-sphere free-list |
| rings | `PlanetPhysicalDef` with `hasRings`, circle renderable, position, orbit | ring free-list (own material handle) |

- `select` re-applies the guards `render()` applies today and yields the rows
  `sync` needs.
- `create` pops a pooled entry (or builds one when the list is empty) and adds
  it to the graph.
- `sync` sets position (`x`, `y`, `PositionZDef.z ?? 0`), scale, orientation,
  fill / material handle values, and stamps `userData.id` / `kind`.
- `remove` pushes the entry back on its free-list. The engine has already
  detached the mesh from `group`, so no `visible = false` sweep exists.
- The graph passed to every pass is `group`.

### Frame order in `render()`

1. `syncPerspective` and starfield placement (unchanged).
2. Stars pass. Its `sync` records the star nearest the focus (colour,
   luminosity, position) in a per-frame record; the size floor uses the
   perspective camera set in step 1.
3. Star light placed from that record (unchanged behaviour).
4. Planets pass, rings pass (needs the star light), moons pass, black-hole
   pass.
5. `updateOrbitRings`, then the bloom pipeline / direct draw (unchanged).

### Lifecycle

- Pooled entries are disposed in `ThreeRenderer.dispose()`: every entry in the
  free-lists plus every entry currently held by a pass (the passes are
  `dispose`d first so their entries return to the free-lists).
- Entity ids restart on world reset. The renderer has no reset call site today;
  any future one must call the passes' `dispose(group)`.
- A mesh removed while the tier is not `system` stays in its free-list; the
  passes only run while `render()` runs, so leaving the tier does not remove
  objects (`group.visible` handling is unchanged).

## Testing

Unit tests (`body-passes.test.ts`) use fake meshes and materials, no GPU:

- a mesh is created the first frame an entity is selected, reused across frames;
- an entity that stops matching returns its entry to the free-list, and the
  next arrival reuses it (no second material built);
- `select` guards: entities missing renderable / position / non-circle kind are
  skipped; rings only for `hasRings`;
- `dispose` returns every held entry.

`render()` itself is not unit-tested (as today). Browser verification is handed
to Pierre (see checklist).

## Docs

- `docs/research/engine-adoption.md`: move `Scene3DRenderer` from opportunities
  to current usage.
- `docs/roadmap.md`: drop the `Scene3DRenderer` clause; keep the
  `three-renderer.ts` split item only for what remains.
- `docs/codebase.md`, `docs/agent/README.md`: add `body-passes.ts`.

## Checklist

- [x] Add `body-passes.ts` with free-lists, the five passes and a per-frame
      nearest-star record.
- [x] Add `body-passes.test.ts` covering the cases above.
- [x] Switch `ThreeRenderer.render()` to the passes; delete the `obtain*`
      pools, `place` helper and surplus-hiding loops.
- [x] Update `ThreeRenderer.dispose()` for the new pools.
- [x] Update docs listed above.
- [x] Peer review (fast model, one structured pass); fix findings.
- [x] `npm run lint:fix && npm run build && npm test`.
- [x] Hand browser checks to Pierre: star light and tint, star size at
      distance, moons and black holes, rings and their shadow, picking,
      streaming in and out without hitches.
- [x] Move this plan to `docs/plans/done/` with the final commit.
