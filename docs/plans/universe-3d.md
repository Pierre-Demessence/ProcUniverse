# B1 3D universe — every tier in true 3D

Goal: take the Z axis beyond the system tier, so galaxies have real disk
thickness, bulge, halo and orientation, one perspective camera works at every
tier, and level of detail follows camera distance. When this ships nothing in
ProcUniverse is a flat plane any more.

Status: B1.0, B1.1 and the B1.1 fixes are done; generation is 3D. Pierre's
browser re-test of the fixes is pending. Next: B1.2. Breaking the current
universe (seeds, RNG streams, saved bookmarks) is accepted.

Out of scope (on the backlog): irregular galaxies (B30), giant planet surfaces
(B10), black-hole visuals (B21), WebGPU compute culling (B24), smooth fly-to
(B38), binary stars (B31). The system tier's
content (orbits, spheres, rings, moons) is already 3D and only changes where it
reads star or galaxy positions.

## Acceptance criteria

- **AC1** THE SYSTEM SHALL place every star system, galaxy and black hole at an
  absolute 3D position that is a pure function of the seed. Check: determinism
  fingerprint test (done in B1.1).
- **AC2** THE SYSTEM SHALL model each disk galaxy with a thin disk, a spheroidal
  bulge and a sparse halo, oriented by a per-galaxy disk normal; ellipticals are
  3D ellipsoids. Check: `galaxies.test.ts` (done in B1.1).
- **AC3** WHEN the camera is at any tier, THE SYSTEM SHALL render through one
  perspective camera that supports orbit, tilt, pan, zoom-to-point and Flatten.
  Check: `camera-controller.test.ts`; Pierre's browser pass.
- **AC4** THE SYSTEM SHALL select the tier from the camera's distance to its
  focus, and keep on-screen work bounded at every distance. Check: `tier.test.ts`
  thresholds and reach bounds.
- **AC5** WHEN the view crosses a tier boundary, THE SYSTEM SHALL cross-fade the
  two representations with no camera jump, angle flip or mirrored image. Check:
  `tierBlend` band tests; Pierre's browser pass.
- **AC6** WHILE the camera is inside or near a galaxy, THE SYSTEM SHALL use that
  galaxy's disk plane as the orbit / pan / Flatten reference plane. Check:
  `plane-basis` tests.
- **AC7** THE SYSTEM SHALL keep GPU coordinates render-origin-relative in all
  three axes. Check: `world-systems.test.ts` rebase tests.
- **AC8** WHEN a version-1 save loads, THE SYSTEM SHALL keep the seed, time and
  preferences, drop the saved view and bookmarks, and log a console note.
  Check: `save.test.ts`.
- **AC9** THE SYSTEM SHALL orient the background sky's galactic band to the host
  galaxy's plane and derive its density from the 3D galaxy model. Check:
  `sky-structure.test.ts`; Pierre's browser pass.

## Design

Generation (done in B1.1) is described by the invariants in `AGENTS.md` and
[D6](../decisions.md) (sector edge and star density). The remaining design:

- **Camera.** One perspective camera for every tier; `syncCamera` and the
  orthographic camera are removed. `camera.zoom` (px per AU at the focus) stays
  the stored quantity, since it already defines distance:
  `d = (viewportH / zoom / 2) / tan(fov / 2)`; a `cameraDistance(cam)` helper is
  the one conversion. `(camera.x, camera.y, focusZ)` is the focus at every tier.
- **Reference plane per tier:** system → focused disk; star and galaxy → the
  host galaxy's disk (`galaxyAt(focus)`), or the last host galaxy in the void;
  galaxy-field → the last host galaxy's plane, easing to world +z at the
  universe tier. `blendPlaneNormal` becomes a slerp between any two normals, so
  every swing is continuous; the star tier's world-+z plane and
  `starTierTiltScale` easing go away.
- **Controls** keep their feel: right-drag orbit / tilt, left-drag pans along
  the reference plane, wheel zooms to the 3D point under the cursor at every
  tier (galaxy tiers resolve against their sprites or the reference plane).
  Flatten works at every tier (top-down onto the reference plane).
- **Floating origin in 3D.** `makeOriginRebaseSystem` rebases on the 3D local
  offset and snaps all three axes to the sector grid when no system is focused.
  `perspectiveClipPlanes` receives the tier's content radius; reversed depth
  stays on.
- **LOD by distance.** `selectTier` compares `cameraDistance` against ly
  thresholds, with hysteresis. Each tier draws content within a reach that
  scales with the camera distance, with a smooth fade at the edge. `tierBlend`
  becomes a list of bands (system ↔ star, star ↔ galaxy, galaxy ↔ galaxy-field,
  galaxy-field ↔ universe); both sides of a band are perspective views of the
  same 3D positions, so a swap needs no tilt easing and has no mirror flip.
- **Star tier.** `star-sprites.ts` unchanged; its range is a 3D sphere around
  the focus, nearest-first under `STAR_SECTOR_BUDGET_MS`.
- **Galaxy tier: per-galaxy particle cloud.** Each galaxy near the camera bakes
  a deterministic cloud of N additive sprites (N ≈ 50–200k, budgeted by screen
  coverage), sampled from its 3D density and activity in its own frame, plus a
  darker dust layer on the mid-plane. Built once per galaxy off the hot path and
  placed by one transform. Near the focus, particles within the star reach fade
  out as real star sprites fade in. Rejected: a ray-marched volume shader
  (prettier dust, much heavier per pixel, hard on the WebGL2 fallback).
- **Galaxy-field tier: oriented impostors.** A quad in each galaxy's disk plane,
  textured from a small cached face-on density bake, plus a camera-facing bulge
  / halo sprite; ellipticals are a camera-facing sprite stretched by their
  projected ellipsoid. Near galaxies cross-fade into their particle clouds.
- **Universe tier.** Galaxy point sprites while the count in reach is under a
  budget; beyond it, 3D cosmic-web aggregate sprites in distance shells
  (super-cells ≥ `TARGET_CELL_PX` on screen). `ensureGlowMesh` gains z and a
  billboard material shared with the galaxy-field sprites.
- **Picking, labels, HUD.** Galaxies are picked by screen-projected distance,
  nearest in depth wins. Labels and the reticle go through `projectToScreen`
  (no `worldToView`). The HUD shows x, y, z (ly) and the host galaxy by 3D
  lookup; the scale bar reads the span at the focus distance. The inspector adds
  galaxy inclination and, for a star, galactocentric radius and height above
  its galaxy's plane.
- **Star-only sector records.** A sector record holds star positions and
  physics only (~1.5 µs a star against ~13 µs for a full system); planets,
  moons and names generate when the system streams at the system tier.
  `nearestSystem` scans the 3×3×3 neighbourhood of the focus's sector.
- **Sky from the 3D galaxy.** The band plane is the host galaxy's disk plane.
  Density and band brightness per direction come from a short ray-march of the
  3D density, baked into the sky-structure map on rebuild. Ellipticals get no
  band, only a smooth glow; lenticulars a faint one. Outside any galaxy the
  dome shows the void sky and nearby galaxy impostors.
- **Persistence.** `SAVE_VERSION` 2: `SavedView` stores the focus as absolute
  `(x, y, z)` (replacing `focusZ`), `Bookmark.z` is required and the `bookmarkZ`
  fallback goes.
- **Start position** stays at the home galaxy's core (deterministic and dense).
- **Risks.** Overdraw of particle clouds when a galaxy fills the screen (budget
  N, small sprites); float precision at universe spans of ~10¹³ AU (positions
  stay origin-relative, reversed depth; verify at the tier edges). Each item
  leaves the app running and green.

## Checklist

Each item updates the `AGENTS.md` invariants, `docs/codebase.md` and
`docs/features.md` it makes stale, and trims backlog entries it delivers; the
last item deletes B1 from the backlog and this plan.

### B1.0 Decisions and proof of concept

- [x] Pierre settled the design choices; Node benchmark of 3D sector sizes and
      the 27-cell density scan (results in [D6](../decisions.md)).

Visible after: nothing: design choices and a benchmark only.
Needs you: nothing.

### B1.1 3D generation

- [x] 3D galaxy cells, disk normals, density (disk, bulge, halo, triaxial
      ellipticals, lenticulars), activity, cosmic web and black holes.
- [x] Cubic 4 ly sectors with Poisson-count sampling; ly tier thresholds;
      `STAR_DENSITY_PEAK` per ly³ and `STAR_DENSITY_SCALE`.
- [x] Every galaxy lookup takes z; 3D keys and ranges in `SectorCache`,
      `SectorRange`, `SystemStreamer`, the star-tier sprite range and
      `nearestSystem`.
- [x] Fixes from Pierre's browser pass: tilt-independent star reach and
      labels, latched tilt easing, bounded galaxy-field depth, galaxy centre
      height for zoom-to and bookmarks, LRU sector cache, z rebase when zoomed
      out, focused star matched by identity.

Visible after: stars, galaxies and the cosmic web have depth; rotating the star
tier no longer pops stars or flips the camera; zoom-to and bookmarks reach other
galaxies.
Needs you: browser re-test of rotation at the star tier, the zoom out to the
universe view, and a bookmark to a non-home galaxy (at the end).

### B1.2 Star-only sector records and 3D streaming

- [ ] Split sector generation into star records and on-demand system bodies
      (`generation/universe.ts`, `lod/streaming.ts`); star placement draws
      keep their order, and the determinism fingerprint is re-pinned only if
      planet draws move.
- [ ] `nearestSystem` over the 3×3×3 neighbourhood; test with a nearer star
      across a sector edge.
- [ ] Star tier fills a 3D sphere around the focus, nearest-first under budget.
- [ ] Tests for `streaming.ts` and `sector-cache.ts` (delivers [B4](../backlog.md)
      for those two files).

Visible after: the star tier fills in faster near a galaxy core; clicking near a
sector edge picks the truly nearest star.
Needs you: browser check that zooming into a dense core fills smoothly (at the
end).

### B1.3 Camera, origin and distance LOD

- [ ] `cameraDistance`; `selectTier` on distance with ly thresholds.
- [ ] 3D floating-origin rebase.
- [ ] Generalised reference-plane slerp; host-galaxy plane at star / galaxy
      tiers; last host plane easing to +z beyond.
- [ ] Perspective camera at every tier; remove `syncCamera`, the orthographic
      camera and `starTierTiltScale` easing.
- [ ] Zoom-to-point and Flatten at every tier.
- [ ] Generalised `tierBlend` bands; unit tests.
- [ ] Tests for `camera-controller.ts` (delivers [B4](../backlog.md) for it).

Visible after: every tier can be orbited and tilted; zooming out of a star view
no longer swings to a top-down mirrored image.
Needs you: browser pass zooming through every tier with tilted views
(stops the run).

### B1.4 Galaxy tier

- [ ] Per-galaxy particle-cloud bake (deterministic, cached, budgeted, off the
      hot path) plus dust layer.
- [ ] Star ↔ galaxy blend: near-field particles fade as real stars fade in.
- [ ] Remove the 2D `forEachGalaxyGlow` grid.

Visible after: a galaxy looks like a 3D cloud of stars that can be seen edge-on.
Needs you: browser look at face-on and edge-on galaxies and the star ↔ galaxy
hand-off (stops the run).

### B1.5 Galaxy-field and universe tiers

- [ ] Face-on density bake per galaxy; oriented disk impostor + bulge sprite;
      ellipsoid sprite for ellipticals.
- [ ] Galaxy ↔ galaxy-field blend (impostor ↔ cloud).
- [ ] Universe tier: galaxy points under budget, 3D cosmic-web shells beyond;
      galaxy-field ↔ universe blend.
- [ ] Billboarded glow mesh with z.

Visible after: zoomed out, galaxies show as tilted spirals and streaks, and the
cosmic web has depth.
Needs you: browser pass of the widest views (at the end).

### B1.6 Picking, labels, HUD and UI

- [ ] Galaxy picking and reticle through the perspective camera.
- [ ] Galaxy-field labels projected in 3D.
- [ ] HUD x / y / z read-out, scale bar at focus distance.
- [ ] Nav tree and inspector 3D lookups; new inspector fields.

Visible after: the HUD shows z; the inspector shows galaxy inclination and a
star's height above its galaxy.
Needs you: browser check of galaxy picking at tilted views (at the end).

### B1.7 Persistence

- [ ] `SAVE_VERSION` 2, absolute 3D focus, required `Bookmark.z`; version-1
      saves handled as AC8; save tests.

Visible after: old saves keep their seed and settings but restart at the home
galaxy, without bookmarks.
Needs you: reload with an old save to confirm (at the end).

### B1.8 Background sky from the 3D galaxy

- [ ] Band plane from the host galaxy's disk normal.
- [ ] Ray-marched density bake into the sky-structure map; type-aware band.
- [ ] Outside a galaxy: void sky plus neighbour galaxy impostors.

Visible after: the Milky-Way-like band follows each galaxy's real tilt and
fades away outside galaxies.
Needs you: browser look at the sky inside a spiral, an elliptical and the void
(at the end).
