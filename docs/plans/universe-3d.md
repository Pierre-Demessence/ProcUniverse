# 3D universe — every tier in true 3D

Take the Z axis beyond the system tier: 3D sectors, galaxies with real disk
thickness, bulge, halo and orientation, a 3D cosmic web, one perspective camera
at every tier, and level of detail chosen by camera distance. When this ships
nothing in ProcUniverse is a flat plane any more.

This is the build plan for [rendering-backend.md](rendering-backend.md) §7
Stage 3 ("Add Z to generation beyond the system tier", "Distance-based LOD")
and the roadmap's "3D beyond the system tier" decision. It replaces the
per-system `systemZ` slab from [star-tier-3d.md](done/star-tier-3d.md) (D1 =
B).

> Status: **Phases 0–1 done** (decisions settled: every recommendation for
> D1–D5 taken; generation is 3D). Phase 2 next. Breaking the current universe
> (seeds, RNG streams, saved bookmarks) is accepted.

## Scope

In scope, everything that is flat today:

- Sector grid, sector hashing, star placement, the star density field.
- Galaxy placement (3D cells), shape (disk + bulge + halo, per-galaxy
  orientation), star-formation activity, central black hole position.
- Cosmic web density.
- Camera: perspective with orbit / tilt / pan at every tier; the orthographic
  camera is retired.
- LOD: tier selection and in-tier detail from camera distance; bounded 3D
  volumes per tier; blends at every tier boundary, not only system ↔ star.
- Rendering of the galaxy, galaxy-field and universe tiers as 3D scenes.
- Picking, hover, labels, reticle, streaming, nearest-system, floating origin,
  HUD read-outs, nav tree, inspector, bookmarks and save in 3D.
- The background sky dome oriented to, and sampled from, the host galaxy's 3D
  structure (the "starfield realism" follow-on).

Out of scope (stay on the [roadmap](../roadmap.md)): irregular galaxies, planet
surfaces, black-hole visuals, WebGPU compute culling, smooth fly-to, binary
stars. The system tier's content (orbits, spheres, rings, moons) is already 3D
and only changes where it reads star or galaxy positions.

## Current state — what is still flat

| Area | Today | File(s) |
| ---- | ----- | ------- |
| Sectors | 2D grid `(sx, sy)`, `LY_PER_SECTOR` = 1 ly squares, `hashSector(seed, sx, sy)`; `STAR_DENSITY_PEAK` = 100 candidates per sector, each kept with probability `galaxyDensityAt(x, y)` | `generation/universe.ts`, `generation/hash.ts`, `config/data.ts` |
| Star height | `systemZ`: a triangular spread over a 3 ly slab, drawn last from each system's stream | `generation/universe.ts` |
| Galaxies | 2D cells of 2 Mly, centre `(centerX, centerY)`, in-plane `orientation`; density is a face-on 2D profile (disk, bulge, arms, bar, elliptical squash) | `generation/galaxies.ts` |
| Cosmic web | 2D bilinear value noise over galaxy cells | `generation/galaxies.ts` |
| Black hole | `BlackHoleData {x, y}` at the galaxy centre | `generation/universe.ts` |
| Tier selection | `selectTier` from `sectorsAcross(zoom)`; thresholds in sectors | `lod/tier.ts`, `config/render.ts` |
| Streaming | `SystemStreamer.update(SectorRange)` over a 2D `(sx, sy)` box; `nearestSystem` scans only the camera's own sector | `lod/streaming.ts`, `lod/nearest-system.ts`, `lod/sector-cache.ts` |
| Galaxy / galaxy-field / universe tiers | Orthographic top-down camera, instanced additive glow sprites at `z = 0` from 2D aggregate grids | `render/three/three-renderer.ts` (`renderGlowTier`, `syncCamera`), `render/three/glow-fields.ts` |
| Reference plane | System tier: focused disk; star tier: fixed world +z ("galactic plane") | `camera/plane-basis.ts`, `frame/systems/render-systems.ts` |
| Floating origin | Rebases x / y on a 2D distance; z only follows the focused star | `frame/systems/world-systems.ts` |
| Picking | Galaxy pick unprojects through the 2D camera | `pick.ts` |
| Galaxy lookups | `galaxyAt(seed, x, y)` in nav state, HUD coords, inspector, selection, sky | `ui/nav-state.ts`, `render/draw-coords.ts`, `ui/inspector.tsx`, `selection-state.ts`, `render/three/three-renderer.ts` |
| Sky dome | Band fixed to the world XY plane; density from 2D `galaxySampleAt` | `render/three/starfield.ts`, `render/three/sky-structure.ts` |
| Save | `SavedView {x, y, zoom, azimuth, tilt, focusZ}`, `Bookmark.z` optional, `SAVE_VERSION` = 1 | `persistence/save.ts`, `bookmarks.ts` |

## Requirements

- **R1.** THE SYSTEM SHALL place every star system, galaxy and black hole at an
  absolute 3D position that is a pure function of the seed.
- **R2.** THE SYSTEM SHALL model each disk galaxy with a thin disk (vertical
  scale height), a spheroidal bulge and a sparse halo, oriented by a
  per-galaxy disk normal; elliptical galaxies SHALL be 3D ellipsoids.
- **R3.** WHEN the camera is at any tier, THE SYSTEM SHALL render through one
  perspective camera that supports orbit, tilt, pan, zoom-to-point and Flatten.
- **R4.** THE SYSTEM SHALL select the tier from the camera's distance to its
  focus, and SHALL keep on-screen work bounded at every distance.
- **R5.** WHEN the view crosses a tier boundary, THE SYSTEM SHALL cross-fade the
  two representations with no camera jump, angle flip or mirrored image.
- **R6.** WHILE the camera is inside or near a galaxy, THE SYSTEM SHALL use that
  galaxy's disk plane as the orbit / pan / Flatten reference plane.
- **R7.** THE SYSTEM SHALL keep GPU coordinates render-origin-relative in all
  three axes (floating origin in 3D).
- **R8.** WHEN a save from before this change loads, THE SYSTEM SHALL keep the
  seed and preferences and discard what no longer resolves (see D4).
- **R9.** THE SYSTEM SHALL orient the background sky's galactic band to the host
  galaxy's plane and derive its density from the 3D galaxy model.

## Design

### 1. 3D sectors and star placement

- **Cubic sectors.** A sector is a cube `(sx, sy, sz)` of edge `SECTOR_SIZE`.
  `hashSector` / `hashSystem` fold in `sz`; `SectorData` gains `sz`;
  `SectorRange` gains `minSz` / `maxSz`; cache keys become `sx,sy,sz`.
- **`SystemData.z`** comes from the candidate position inside the cube.
  `systemZ` and `STAR_SLAB_THICKNESS_LY` are deleted.
- **Poisson-count sampling instead of fixed rejection.** A 3D grid multiplies
  the sector count (a 20 ly reach is ~33,000 one-ly cubes, against ~1,600
  squares today), and most cubes are near-empty. Evaluating 100 candidates in
  each would cost millions of density calls per view. Instead, each sector
  evaluates a cheap density upper bound over its cube (the dominant galaxy's
  density at the point of the cube nearest the galaxy centre), draws a
  candidate count from a Poisson distribution with mean `peak · bound ·
  volume`, then thins each candidate by `density / bound`. Empty space costs
  one hash and one bound; the result is still an exact inhomogeneous Poisson
  process, seamless across sector edges.
- **Density unit.** `STAR_DENSITY_PEAK` becomes stars per ly³ at a galaxy's core
  (see D1 for realistic vs. tuned values).
- **Sector edge** is a measured choice (D1): larger cubes mean fewer sectors per
  view but more stars per dense-core sector.

### 2. Galaxies in 3D

- **3D galaxy cells.** `makeGalaxy(seed, gx, gy, gz)`; the centre jitters in all
  three axes; the home galaxy stays at the origin. `hashGalaxy` folds `gz`; the
  cell cache key widens to three coordinates.
- **Orientation.** Each galaxy draws a uniformly random disk normal (the same
  `cos i = 1 − 2u`, node `2π·v` rule systems use), stored as `diskNormal` plus
  a precomputed orthonormal basis (in-plane axes carry the existing
  `orientation` phase for the arms and bar). The home galaxy's normal is +z so
  the familiar start view is unchanged in spirit.
- **Density `galaxyDensityOf(g, x, y, z)`**: transform the point into the
  galaxy frame (in-plane `R`, height `h`), then, per the rendering-backend §10
  decision (hybrid, "Option C"):
  - thin disk: the existing radial × arm × bar profile times a vertical
    `sech²(h / z₀)` with scale height `z₀ = GALAXY_DISK_SCALE_HEIGHT_LY ·
    GALAXY_DISK_PUFF` (flaring gently with radius);
  - bulge: a spheroid `exp(−r_sph / r_b)` (oblate for barred spirals, so the
    bar reads as a peanut in edge-on views);
  - halo: a faint power-law sphere for disk galaxies, cut at the galaxy radius;
  - ellipticals: a triaxial ellipsoid (axis ratios drawn from the existing
    `ellipticity` plus one new ratio); lenticulars: a disk with a thick bulge
    and no arms.
  - Normalised so the core is 1, as today.
- **Activity** gets the same 3D transform; the halo and bulge are old
  (`POP_ACTIVITY_OLD`), the disk mid-plane on the arms is young.
- **Dominant-galaxy scan** becomes 3×3×3 cells (27 memoised lookups). A
  per-galaxy bounding-sphere test short-circuits the transform, so the common
  void / single-galaxy case stays cheap. `galaxiesInRect` becomes
  `galaxiesInBox` (and a frustum / sphere variant for rendering).
- **Black hole** sits at the galaxy's 3D centre; `BlackHoleData` gains `z`;
  `galaxyCenteredIn` takes a 3D box.
- **Derived statistics** (`estimatedStarCount`, stellar mass …) integrate the 3D
  profile; formulas updated and unit-tested.

### 3. Cosmic web in 3D

`cosmicDensity(seed, gx, gy, gz)`: trilinear value noise over 3D web nodes
(8 corners instead of 4). Occupancy and the morphology–density bias read it as
today. Filaments and voids then exist in volume, which the universe tier shows
(§6).

### 4. Camera, reference plane and floating origin

- **One perspective camera for every tier.** `syncCamera` and the orthographic
  camera are removed. `camera.zoom` (px per AU at the focus) stays the stored
  quantity — it already defines distance: `d = (viewportH / zoom / 2) /
  tan(fov / 2)` — so pan / zoom / save code keeps working. A helper
  `cameraDistance(cam)` becomes the one conversion.
- **Focus is 3D everywhere.** `(camera.x, camera.y, focusZ)` is the focus at
  every tier (today `focusZ` only matters at system / star tiers).
- **Reference plane per tier:** system → focused disk; star and galaxy → the
  host galaxy's disk (`galaxyAt(focus)`), or the last host galaxy in the void;
  galaxy-field and universe → the last reference plane, easing to world +z (D3).
  `blendPlaneNormal` generalises from "disk → +z" to a slerp between any two
  normals, so every swing is continuous. The star tier's current world-+z plane
  and its tilt ease toward the galaxy swap (`starTierTiltScale`) go away.
- **Controls** unchanged in feel: right-drag orbit / tilt, left-drag pans along
  the reference plane, wheel zooms to the 3D point under the cursor at every
  tier (the resolver already exists for the star tier; galaxy tiers resolve
  against their sprites or the reference plane). Flatten works at every tier
  (top-down onto the reference plane: a galaxy seen face-on).
- **Floating origin in 3D.** `makeOriginRebaseSystem` rebases on the 3D local
  offset (`|x|`, `|y|` or `|focusZ|` beyond `REBASE_DIST`) and snaps all three
  axes to the sector grid when no system is focused.
- **Clip planes.** `perspectiveClipPlanes` receives the tier's content radius;
  reversed depth stays on, so universe-scale depth ranges are fine.

### 5. LOD by distance

- **Tier from distance.** `selectTier` compares `cameraDistance` against
  thresholds in ly (AU internally), not sectors across, so the sector edge (D1)
  no longer moves tier boundaries. Hysteresis kept.
- **Bounded 3D volume per tier.** Each tier draws content within a reach around
  the focus that scales with the camera distance (e.g. 2–3× the view half-span,
  more along a tilted view's depth), with a smooth distance fade at the edge.
  This replaces "cells overlapping the 2D view rectangle".
- **Blends at every boundary.** `tierBlend` generalises to a list of bands
  (system ↔ star exists; add star ↔ galaxy, galaxy ↔ galaxy-field,
  galaxy-field ↔ universe). Each band renders both layers in the one scene with
  complementary weights. Since both sides are perspective views of the same 3D
  positions, the swap needs no tilt easing and has no mirror flip.
- **Distance within a tier.** Near content gets finer representation than far
  content in the same frame (a tilted galaxy view sees near and far disk at
  once); see the galaxy tier (§6).

### 6. Rendering per tier

- **Star tier.** Unchanged renderer (`star-sprites.ts`); its sector range is a
  3D sphere around the focus, nearest-first under `STAR_SECTOR_BUDGET_MS`.
  Depends on star-only sector records (§8).
- **Galaxy tier: a per-galaxy particle cloud.** The 2D power-of-two glow grid
  does not scale to 3D (cell counts cube). Instead, each galaxy near the camera
  bakes a deterministic cloud of N additive sprites (N ≈ 50–200k, budgeted),
  sampled from its 3D density and activity in the galaxy's own frame, plus a
  darker dust layer along the disk mid-plane. The cloud is built once per galaxy
  (cached, rebuilt off the hot path) and placed by a single transform (centre +
  basis), so orbiting and zooming cost nothing but the draw. This is the
  approach of SpaceEngine and Gaia Sky's galaxy views.
  - Near the focus, particles within the star tier's reach fade out as real star
    sprites fade in (the star ↔ galaxy blend), so nearby space is never counted
    twice.
- **Galaxy-field tier: oriented impostors.** Each galaxy is a quad lying in its
  own disk plane, textured from a face-on density bake (arms, bar, bulge;
  one bake per galaxy, small, cached), plus a camera-facing bulge / halo sprite.
  Edge-on galaxies read as thin streaks, face-on ones as spirals. Ellipticals are
  a camera-facing sprite stretched by their projected ellipsoid. Galaxies near
  the camera cross-fade into their particle clouds.
- **Universe tier.** Galaxies as point sprites while the count in reach stays
  under a budget; beyond it, 3D cosmic-web aggregate sprites in distance shells
  (super-cells sized so each stays ≥ `TARGET_CELL_PX` on screen, coarser with
  distance).
- **Shared glow mesh** (`ensureGlowMesh`) gains a z coordinate and becomes a
  camera-facing billboard material, reused by the universe and galaxy-field
  sprites.

### 7. Picking, labels, HUD, UI

- **Picking:** galaxies by screen-projected distance through the perspective
  camera (as star picking does), nearest-in-depth wins; `pickGalaxyAt` rewritten.
- **Labels / reticle:** all through `projectToScreen`; galaxy-field labels and
  the galaxy reticle drop `worldToView`.
- **HUD coordinates** show x, y, z (ly) and the host galaxy by 3D lookup; the
  scale bar reads the world span at the focus distance.
- **Nav tree / inspector:** `galaxyAt(x, y, z)`; the inspector adds galaxy
  inclination (to world +z) and, for a star, galactocentric radius and height
  above its galaxy's plane.

### 8. Streaming, nearest system and sector records

- **Star-only sector records** (a roadmap perf item, now a prerequisite): a
  sector record holds star positions and physics only; planets / moons / names
  generate when the system is streamed at the system tier. Cubic sector counts
  make generating every planet at the star tier unaffordable.
- `SystemStreamer` and `SectorCache` take 3D keys and ranges; cache capacity is
  re-derived from the new worst-case star-tier range (pinned by a test).
- `nearestSystem` scans the 3×3×3 neighbourhood of the focus's sector (today it
  only checks the focus's own sector, which misses nearer stars across an
  edge).

### 9. Background sky from the 3D galaxy

- The sky dome's band plane is the host galaxy's disk plane, not world XY.
- Star density and band brightness per direction come from integrating the 3D
  density along the view ray (a short ray-march, baked into the existing
  sky-structure map on rebuild), so the band's width, the bulge toward the core
  and the thinning toward the poles follow from where the camera sits.
- Type-aware: ellipticals have no band, only a smooth glow; lenticulars a faint
  one. Outside any galaxy the dome shows the void sky and nearby galaxies (their
  impostors from §6) instead of a band.

### 10. Persistence

- `SAVE_VERSION` → 2. `SavedView` stores the focus as absolute `(x, y, z)`
  (renaming `focusZ`), `Bookmark.z` becomes required, `bookmarkZ` fallback
  removed.
- Loading a version-1 save: see D4.

## Decisions

Settled: every recommendation below was taken. D1's numbers come from the
Phase 0 benchmark (see [Phase 0 results](#phase-0-results)).

- **D1 — sector edge and star density.** Recommended: keep the tier thresholds
  in ly (so this does not move them), benchmark 1 ly vs 4 ly cubes in Phase 0
  and take the cheaper; set density per ly³ with a knob. Realistic values are
  sparse: ~0.004 stars / ly³ near a Sun-like radius (≈ 130 stars within 20 ly)
  and a few per ly³ in a bulge. Today's flat model is far denser than real (up
  to 100 per ly² column). Options: (a) realistic density, (b) realistic shape
  with an overall density multiplier (recommended, default ×1, tunable after the
  browser pass), (c) keep today's apparent density.
- **D2 — galaxy tier representation.** Recommended: per-galaxy particle cloud
  (§6). Alternative: a ray-marched volume shader over the density field
  (prettier dust, much heavier per pixel, and not portable to the WebGL2
  fallback without care).
- **D3 — reference plane beyond the galaxy tier.** Recommended: keep the last
  host galaxy's plane through galaxy-field, easing to world +z at the universe
  tier. Alternative: world +z for both.
- **D4 — old saves.** Recommended: on a version-1 save keep the seed, time and
  preferences; drop bookmarks and the saved view (their bodies no longer exist
  in the regenerated universe) and log a console note. Alternative: reset the
  whole save.
- **D5 — start position.** Today the app starts at the home galaxy's core.
  Recommended: keep it (the origin is deterministic and dense); a "Sun-like
  radius in the disk" start is a separate roadmap item.

## Risks

- **K1 — generation cost of cubic sectors.** Mitigated by Poisson-count
  sampling, star-only records, the per-frame budget and D1's benchmark.
- **K2 — 27-cell dominant-galaxy scan** on every density call. Mitigated by the
  memoised cell cache, bounding-sphere rejects and a sector-level bound.
- **K3 — overdraw of galaxy particle clouds** when a galaxy fills the screen.
  Budget N by screen coverage; small sprites; measure with the performance
  budget item on the roadmap.
- **K4 — float precision at the universe tier** (~10¹³ AU spans). Positions stay
  render-origin-relative; reversed depth on. Verify at the tier edges.
- **K5 — scope.** This touches generation, LOD, camera, rendering and
  persistence. Each phase below leaves the app running and green so it can ship
  incrementally.

## Phases and checklist

### Phase 0 — decisions and proof of concept

- [x] Pierre settles D1–D5 (all recommendations taken).
- [x] Node benchmark: 3D sector generation (1 / 2 / 4 / 8 ly cubes,
      Poisson-count sampling) and the 27-cell density scan, at a core, bulge,
      disk, halo and void focus.
- [x] Record the chosen sector edge and density knobs (below). They land in
      `config/data.ts` in Phase 1, together with the ly-based tier thresholds,
      because today's thresholds are counted in sectors.

#### Phase 0 results

Throwaway Node benchmark over the real generation code, with a prototype 3D
density (27-cell scan, `sech²` disk of 1,000 ly scale height, spheroidal
bulge, no halo yet) and Poisson-count cube sampling of star-only records (star
physics + name). Star-tier reach 20 ly (the current `STAR_MAX_REACH_LY`),
realistic density (0.004 stars / ly³ at a mid-plane point 25,000 ly out, which
calibrates the core peak to ≈ 0.19 stars / ly³):

| Cube edge | Cubes in reach | Core | Disk | Void |
| --------- | -------------- | ---- | ---- | ---- |
| 1 ly | 38,076 | 43 ms | 29 ms | 14 ms |
| 2 ly | 5,328 | 18 ms | 4.0 ms | 2.0 ms |
| **4 ly** | **804** | **15 ms** | **1.0 ms** | **0.3 ms** |
| 8 ly | 160 | 27 ms | 1.1 ms | 0.1 ms |

- A 3D density call costs 0.48 µs (27 cells) against 0.37 µs today (9 cells):
  the wider scan is not a concern.
- A star-only record costs ~1.5 µs; today's full system (planets, moons,
  names) costs ~13 µs, which is why star-only records (Phase 2) matter.
- Stars within 20 ly: ~6,300 at the core, ~135 in the disk, 0 in the halo /
  void (a halo profile arrives in Phase 1).
- Density ×10 (the D1 dial turned up): ~150 ms to fill a core reach at 4 ly
  cubes, ~40 frames under the 4 ms budget; fine as a tuning ceiling.

**Chosen:** 4 ly cubes (`LY_PER_SECTOR` = 4; fastest at the core and in the disk, within 0.2 ms of
8 ly in the void; 804 cubes fit
the existing 2,048-sector cache). `STAR_DENSITY_PEAK` becomes stars per ly³ at
the core, calibrated so a Sun-like mid-plane point holds 0.004 / ly³ (re-derive
from the final Phase 1 profile), times a new `STAR_DENSITY_SCALE` knob
(default 1).

### Phase 1 — 3D generation

- [x] 3D galaxy cells, centre jitter in z, `diskNormal` + basis, `hashGalaxy`
      and cell cache in 3D.
- [x] 3D density and activity (thin disk `sech²`, bulge spheroid, halo,
      triaxial ellipticals, lenticulars) with `GALAXY_DISK_SCALE_HEIGHT_LY` and
      `GALAXY_DISK_PUFF`.
- [x] 3D cosmic web (trilinear).
- [x] Cubic sectors: `LY_PER_SECTOR` = 4, `hashSector` / `hashSystem` with
      `sz`, Poisson-count sampling, `SystemData.z` from position; delete
      `systemZ` and `STAR_SLAB_THICKNESS_LY`.
- [x] `STAR_DENSITY_PEAK` in stars / ly³ and `STAR_DENSITY_SCALE`; tier
      thresholds in ly (`*_LY`, `REBASE_LY`) so the new sector edge does not
      move them. Final calibration 0.09 / ly³: the 0.004 / ly³ target is the
      azimuth-averaged mid-plane at 25,000 ly (arms included), where Phase 0
      used a single inter-arm point (0.19).
- [x] Black hole at the 3D galaxy centre.
- [x] Update every `galaxyAt` / `galaxyDensityAt` / `galaxiesInBox` /
      `cosmicDensity` caller to pass z. Interim until Phases 4–5: the galaxy
      and universe tiers draw the density slice at the focus height; the
      galaxy-field tier (and its picking / labels) draws the cube of space
      around the focus, projected top-down; the sky dome samples the host
      galaxy at its centre height.
- [x] Tests: determinism (new pinned fingerprint), density symmetry, scale
      height, pole-following, halo, triaxial ellipticals, the bound's
      upper-bound property, orthonormal galaxy frames, 3D cosmic web, Poisson
      statistics, stars inside their own cube, core / disk / halo density.
      Seams need no test of their own: each cube is an independent Poisson
      process at the exact density, so faces are seamless by construction.
- [x] Pulled forward from Phase 2 (needed to keep the app running): 3D keys and
      ranges in `SectorCache`, `SectorRange`, `SystemStreamer`, the star-tier
      sprite range (a cube around the focus, 3D reach), and `nearestSystem`
      reading the focus's 3D sector.

### Phase 2 — star-only sector records and 3D streaming

- [ ] Split sector generation into star records and on-demand system bodies.
- [x] `SectorCache`, `SectorRange`, `SystemStreamer` in 3D; capacity test
      (done in Phase 1).
- [ ] `nearestSystem` over the 3×3×3 neighbourhood.
- [ ] Star tier fills a 3D sphere around the focus, nearest-first under budget.
- [ ] Tests for `streaming.ts` and `sector-cache.ts` (roadmap engineering item).

### Phase 3 — camera, origin and distance LOD

- [ ] `cameraDistance`; `selectTier` on distance with ly thresholds.
- [ ] 3D floating-origin rebase.
- [ ] Generalised reference-plane slerp; host-galaxy plane at star / galaxy
      tiers; D3 behaviour beyond.
- [ ] Perspective camera at every tier; remove `syncCamera` and the
      orthographic camera; remove `starTierTiltScale` easing.
- [ ] Zoom-to-point and Flatten at every tier.
- [ ] Generalised `tierBlend` bands; unit tests.
- [ ] Tests for `camera-controller.ts` (roadmap engineering item).

### Phase 4 — galaxy tier

- [ ] Per-galaxy particle-cloud bake (deterministic, cached, budgeted, built off
      the hot path) plus dust layer.
- [ ] Star ↔ galaxy blend: near-field particles fade as real stars fade in.
- [ ] Remove the 2D `forEachGalaxyGlow` grid.

### Phase 5 — galaxy-field and universe tiers

- [ ] Face-on density bake per galaxy; oriented disk impostor + bulge sprite;
      ellipsoid sprite for ellipticals.
- [ ] Galaxy ↔ galaxy-field blend (impostor ↔ cloud).
- [ ] Universe tier: galaxy points under budget, 3D cosmic-web shells beyond;
      galaxy-field ↔ universe blend.
- [ ] Billboarded glow mesh with z.

### Phase 6 — picking, labels, HUD and UI

- [ ] Galaxy picking and reticle through the perspective camera.
- [ ] Galaxy-field labels projected in 3D.
- [ ] HUD x / y / z read-out, scale bar at focus distance.
- [ ] Nav tree and inspector 3D lookups; new inspector fields.

### Phase 7 — persistence

- [ ] `SAVE_VERSION` 2, absolute 3D focus, required `Bookmark.z`; D4 migration;
      save tests.

### Phase 8 — background sky from the 3D galaxy

- [ ] Band plane from the host galaxy's disk normal.
- [ ] Ray-marched density bake into the sky-structure map; type-aware band.
- [ ] Outside a galaxy: void sky plus neighbour galaxy impostors.

### Wrap-up

- [ ] `npm run build`, `npm test`, `npm run lint` green after every phase.
- [ ] Pierre browser-tests each phase (zoom through every tier, tilted views,
      edge-on galaxies, bookmarks, reload).
- [ ] Update `docs/features.md`, `docs/codebase.md`, `docs/agent/README.md`,
      `docs/roadmap.md` (remove the absorbed items), and mark Stage 3 done in
      `rendering-backend.md`.
- [ ] Sweep deferred items into the roadmap; move this plan to `done/`.
