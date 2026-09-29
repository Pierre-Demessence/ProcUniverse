# Roadmap

The single living backlog for ProcUniverse: everything wanted but not yet built.
Shipped work is listed in [features.md](features.md); in-flight work has a plan
under [plans/](plans/). When an item is picked up, write a plan for it and
remove it from here once it ships. Links point to the design context.

## Direction

- **3D is the primary view.** Three.js renders every tier and is the default.
  Canvas 2D is frozen as the fallback when Three cannot load or initialise; it
  gets no new features.
- **The universe is deterministic.** Everything regenerates from the seed; only
  the seed and player state are saved.

## Architecture decisions to make

- **3D beyond the system tier.** Systems are 3D; sectors, galaxies, and the
  cosmic web are a flat plane. Adding a Z axis there (galaxy disk thickness,
  bulge, inclination) touches generation, LOD, and the camera, so decide it
  before building more on the flat model. Design:
  [rendering-backend.md §7 Stage 3](plans/rendering-backend.md).
  - Follow-on: starfield realism (band on each galaxy's own plane, type-aware,
    true 3D density, inside-vs-outside a galaxy).
- **Distance-based LOD** to replace zoom-level tier selection (depends on the
  item above).
- **Retire the Canvas 2D renderer** once the fallback is no longer needed;
  decide what to show when 3D cannot start.

## Engineering health

- Split `src/main.ts`: extract bookmark navigation, renderer switching, and
  selection tracking from the single `start()` closure so they can be tested.
- Split `ThreeRenderer.render()` (and the 959-line `three-renderer.ts`).
- Tests for `camera-controller.ts`, `lod/streaming.ts`, and
  `lod/sector-cache.ts` (the source of most recent camera / reload fixes).
- A performance budget: frame-time and star-count measurement per tier.

## Rendering and visuals

- **Planet surfaces** (shelved until the look can be iterated with Pierre in
  the loop): gas / ice giant bands, rocky surfaces with ice caps and oceans,
  atmospheres (rim glow, clouds), moon surfaces.
  [planet-surfaces.md](plans/planet-surfaces.md)
- **Ring polish:** edge-on Fresnel transparency; backlit glow.
  [planet-rings.md](plans/done/planet-rings.md)
- **Eclipses / cast shadows** (optional, costly).
  [system-visuals.md](plans/system-visuals.md)
- **Black-hole visuals:** animated accretion disk, photon ring, optional
  lensing post-process.
- **Cosmic-web / nebula** additive noise from `cosmicDensity`.
- **LOD retune:** show more individual stars before the aggregate glow.
- **WebGPU compute** (progressive): GPU culling and a GPU particle star field.
- Inspector thumbnail of the rendered body; per-body material cache.
- Open design questions: which effects get a settings toggle; ambient fill vs
  fully dark night side; lighting for binary stars.
  [system-visuals.md §6](plans/system-visuals.md)
- Re-flatten orbit inclinations in the Flatten view — only if steeply inclined
  orbits are ever generated (today's small inclinations are invisible top-down).

## Generation and data

- **Minor moons:** lazy, focus-driven spawn of small irregular satellites as
  clickable bodies. [moons.md 5e](plans/done/moons.md)
- **Irregular galaxies** (fifth morphology).
  [realistic-simulation.md G2b](plans/done/realistic-simulation.md)
- **Binary / multi-star systems.**
- Extra physical properties: magnetic field, star variability, galaxy
  mass–metallicity and satellite count, galaxy-colour coupling, absolute visual
  magnitude, synodic period, black-hole sphere of influence and tidal
  disruption radius; illustrative flavour fields (core temperature, pressure,
  geology).
  [celestial-properties.md](plans/done/celestial-properties.md),
  [research](research/celestial-properties-extensions.md)
- Galaxy-relative hierarchical addressing — only if realistic galaxy sizes are
  ever wanted.

## Navigation and UX

- Click a system at the star tier to inspect it (star properties, planet count).
- Smooth fly / warp-to-target instead of instant jumps.
  [camera-focus-and-lock.md](plans/done/camera-focus-and-lock.md)
- Startup framing and zoom feel retune.
  [realistic-scale.md](plans/done/realistic-scale.md)
- Location tree: sub-galaxy region nodes (core, disk, arms, halo).
- Bookmarks: reordering, folders, notes / custom labels, export / import, count
  badge. [bookmarks.md](plans/done/bookmarks.md)

## Persistence

- **Player deltas:** visited / named bodies persisted via the engine `save`
  module.
