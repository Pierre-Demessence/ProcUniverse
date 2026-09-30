# Roadmap

The single living backlog for ProcUniverse: everything wanted but not yet built.
Shipped work is listed in [features.md](features.md); in-flight work has a plan
under [plans/](plans/). When an item is picked up, write a plan for it and
remove it from here once it ships. Links point to the design context.

## Direction

- **3D is the only renderer.** Three.js renders every tier; a transparent 2D
  overlay carries labels, the reticle and the HUD.
- **The universe is deterministic.** Everything regenerates from the seed; only
  the seed and player state are saved.

## Architecture decisions to make

- **3D beyond the system tier.** Systems are 3D; sectors, galaxies, and the
  cosmic web are a flat plane. Adding a Z axis there (galaxy disk thickness,
  bulge, inclination) touches generation, LOD, and the camera, so decide it
  before building more on the flat model. Design:
  [rendering-backend.md §7 Stage 3](plans/rendering-backend.md).
  - Direction chosen: this is the end goal. The 3D star tier
    ([star-tier-3d.md](plans/done/star-tier-3d.md)) shipped first with a
    per-system height (`systemZ`, a thin local slab) that this work replaces.
    Bookmarks and the save already store absolute z.
  - Follow-on: starfield realism (band on each galaxy's own plane, type-aware,
    true 3D density, inside-vs-outside a galaxy).
- **Distance-based LOD** to replace zoom-level tier selection (depends on the
  item above).

## Engineering health

- Move canvas / DPR sizing out of `main.ts` into its own module.
- Split the remaining ~800-line `three-renderer.ts` (glow tiers, orbit rings,
  camera sync); the system-tier bodies live in `body-passes.ts` and the star
  sprites in `star-sprites.ts`.
- Tests for `camera-controller.ts`, `lod/streaming.ts`, and
  `lod/sector-cache.ts` (the source of most recent camera / reload fixes).
- A performance budget: frame-time and star-count measurement per tier.
- Performance follow-ups (measured in a Node benchmark):
  - Star-tier sector generation builds every system in full (planets, moons,
    names): ~1 ms per dense-core sector. A per-frame budget now spreads it (a
    wide or tilted 3D star view fills in over a few frames); star-only sector
    records with planets generated at the system tier would remove the cost.
  - Star-tier hover projects every drawn star each frame (~30k near a core);
    cache screen positions or use a coarse grid if it shows in profiles.
  - A starfield rebuild still costs ~115 ms at the system tier (~70 ms galaxy
    sampling, ~30 ms sky-structure bake, ~15 ms map lookups; on a focus jump
    of more than ~50,000 AU); spread it over frames or move it to a worker.
  - At the system tier, focusing a different star moves the render origin,
    which despawns and respawns every streamed sector (unmeasured hitch risk).

## Rendering and visuals

- **Planet surfaces** (shelved until the look can be iterated with Pierre in
  the loop): gas / ice giant bands, rocky surfaces with ice caps and oceans,
  atmospheres (rim glow, clouds), moon surfaces.
  [planet-surfaces.md](plans/planet-surfaces.md)
- **Close-up surface detail:** moon maps bake at 256 px wide (memory: a giant
  can hold dozens of moons), so a moon filling the screen at deep zoom looks
  soft. Re-bake the focused / nearest body at a higher width while it is large
  on screen, and release it after.
- **Ring polish:** edge-on Fresnel transparency; backlit glow.
  [planet-rings.md](plans/done/planet-rings.md)
- **Eclipses / cast shadows** (optional, costly).
  [system-visuals.md](plans/system-visuals.md)
- **Starfield sky polish** (options, references and details:
  [starfield-enhancements.md](research/starfield-enhancements.md)):
  - Hybrid sky: the nearest generated systems as real sky stars (true
    direction, brightness from luminosity and distance) over the dome at the
    system tier. The star tier already draws them (per-system heights exist);
    the remaining step is showing them from inside a system.
  - Intergalactic-void sky: almost no stars, other galaxies as smudges.
  - Neighbour galaxies visible as faint smudges from inside a galaxy.
  - Coloured nebulae along the band, tied to open clusters.
  - Bulge size / brightness scaled by distance to the galaxy core.
- **3D star tier polish:** hover highlight beyond the reticle, tuning of the
  brightness / spike / label knobs from Pierre's browser pass, and a gentler
  star → galaxy swap (the star tier eases to top-down but the orthographic
  galaxy view is mirrored in y relative to it).
  [star-tier-3d.md](plans/done/star-tier-3d.md)
- **Reference-plane swing (star-tier-3d R1):** across the cross-fade the view
  swings from the system's disk to the galactic plane (up to 180° for an
  upside-down disk). If it reads as a roll, keep the disk plane for the whole
  star tier and realign only at the galaxy swap.
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
