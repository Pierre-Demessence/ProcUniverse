# Backlog

Everything wanted but not built yet. Shipped work is in
[features.md](features.md); an item being built has a plan under
[plans/](plans/).

Next ID: B45

## 3D universe

- B1 Every tier in true 3D: perspective camera everywhere, distance-based LOD,
  3D galaxy / galaxy-field / universe rendering, sky from the 3D galaxy —
  [plans/universe-3d.md](plans/universe-3d.md).

## Engineering health

- B44 Fix the defects found in the November 2026 project review (CI,
  selection, zoom input, physics display, render, saving) —
  [plans/review-fixes.md](plans/review-fixes.md).
- B2 Move canvas / DPR sizing out of `main.ts` into its own module.
- B3 Split the remaining ~800-line `three-renderer.ts` (glow tiers, orbit rings,
  camera sync) — `ThreeRenderer`.
- B5 Performance budget: frame-time and star-count measurement per tier.
- B6 Star-tier hover projects every drawn star each frame (~30k near a core);
  cache screen positions or use a coarse grid if it shows in profiles —
  `StarSpriteLayer`.
- B7 A starfield rebuild costs ~115 ms at the system tier on a focus jump of
  more than ~50,000 AU (~70 ms galaxy sampling, ~30 ms sky-structure bake);
  spread it over frames or move it to a worker (engine `modules/worker-pool`) —
  `ThreeRenderer.updateStarfield`.
- B9 Each rocky planet bakes a 1024 × 512 surface map on first draw; measure the
  hitch on system entry and stagger bakes if needed — `surface-bake.ts`,
  `PLANET_SURFACE_MAP_WIDTH`.

## Rendering and visuals

- B10 Gas / ice giant surfaces with their cloud face: baked like
  `rocky-surface.ts`, a tuning object in `config/render.ts` and a lab folder;
  recipe in [research/gas-giant-shading.md](research/gas-giant-shading.md).
  Giants show a flat fill plus rim glow today (`isRockyType`).
- B11 Band and cloud motion after B10: drift the baked map in longitude at a
  per-latitude rate (wrapped, never `p + time · dir`); sim vs wall-clock time
  base to decide — `cloud-material.ts`.
- B12 Pierre's lab tuning pass for atmosphere, moon and cloud looks
  (`ATMOSPHERE_LOOKS`, `MOON_SURFACE`, `CLOUD_LOOKS` hold starting values).
- B13 Close-up surface detail: moon maps bake at 256 px wide, so a moon filling
  the screen looks soft; re-bake the focused body wider while it is large on
  screen, release it after.
- B14 Ring polish: edge-on Fresnel transparency, backlit forward-scatter glow,
  and a cone / penumbra planet shadow instead of the cylindrical one —
  `planet-rings.ts`.
- B15 Eclipses / cast shadows (optional, costly).
- B16 Hybrid sky: the nearest generated systems as real sky stars over the dome
  at the system tier ([research/starfield-enhancements.md](research/starfield-enhancements.md)
  §1).
- B17 Neighbour galaxies as faint smudges in the sky from inside a galaxy.
- B18 Coloured nebulae along the sky band, tied to open clusters.
- B19 3D star tier polish: hover highlight beyond the reticle; tune the
  brightness / spike / label knobs from Pierre's browser pass —
  `StarSpriteLayer`, `star-brightness.ts`.
- B20 Across the system → star cross-fade the view swings from the system's disk
  to the galactic plane (up to 180° for an upside-down disk); if it reads as a
  roll, keep the disk plane for the whole star tier — `planeBasis`.
- B21 Black-hole visuals: animated accretion disk, photon ring, a jet when
  `isActiveGalacticNucleus`, optional lensing post-process.
- B22 Cosmic-web / nebula additive noise from `cosmicDensity` (engine
  `modules/noise`).
- B23 LOD retune: show more individual stars before the aggregate glow.
- B24 WebGPU compute (progressive): GPU culling and a GPU particle star field.
- B25 Inspector thumbnail of the rendered body; per-body material cache.
- B26 Lighting options: a "realistic dark" night side or lower default than
  `LIGHT_AMBIENT` (0.15); whether any effect gets a settings toggle (none today,
  see [D8](decisions.md)).
- B27 Re-flatten orbit inclinations in the Flatten view — only if steeply
  inclined orbits are ever generated.
- B28 Selective bloom through an emissive render target, if lit planets ever
  cross `BLOOM_THRESHOLD`.

## Generation and data

- B29 Minor moons: lazily spawn small irregular satellites for the focused
  planet only (outer Hill band ~0.15–0.5 R_Hill, low occupancy, eccentric,
  inclined, some retrograde, continuing the `hashMoon` slot walk), despawn on
  focus loss; tiny, pickable, unlabelled, separately capped — `generation/moons.ts`.
- B30 Irregular galaxies: a fifth morphology with clumpy noise density and a few
  offset blue star-forming blobs — `drawType` in `generation/galaxies.ts`.
- B31 Binary / multi-star systems, with two star lights and a per-body choice of
  light — `obtainStarLight`.
- B32 Extra physical properties: magnetic field, star variability, galaxy
  mass–metallicity, satellite count and colour coupling, absolute visual
  magnitude, synodic period, black-hole sphere of influence and tidal disruption
  radius, planet Hill radius / Roche limit rows, vis-viva speeds, solar day and
  season strength, galaxy rotation curve; illustrative flavour fields. Formulas
  in [research/celestial-properties-extensions.md](research/celestial-properties-extensions.md);
  new sampled fields append draws at the end of their sampler.
- B33 Stellar evolution and remnants (giants, white dwarfs, neutron stars,
  stellar black holes) and brown dwarfs below `IMF_MIN_MASS`; every star is
  main-sequence today — `generation/stars.ts`.
- B34 Asteroid and Kuiper belts, comets.
- B35 Hill-stability check on planet spacing (spacing uses `ORBIT_RATIO_*`
  only) — `generation/universe.ts`.
- B36 Correlated star placement (open clusters, star-forming regions); placement
  is uniform Poisson thinning today.
- B37 Ridged cosmic-web filaments instead of blobby value noise — `cosmicDensity`
  (reshuffles every universe, see [D4](decisions.md)).

## Navigation and UX

- B38 Smooth fly to target instead of the instant Zoom-to jump: ease position
  with a smoothstep and zoom geometrically over ~`FLY_DURATION_MS` (defined,
  unused), any input cancels; engine `modules/tween` / `easing` fit.
- B39 Retune startup framing (the 40 AU start frame near the home black hole is
  nearly empty), `ZOOM_STEP_MAX` and tier transition feel at real scale.
- B40 Location tree: sub-galaxy region nodes (core, disk, arms, halo).
- B41 Bookmarks: reordering, folders, notes / custom labels, export / import,
  count badge on the inspector star.
- B42 Optional start at a Sun-like radius in the home galaxy's disk (the start
  stays the core by default).

## Persistence

- B43 Player deltas: visited / named bodies through the engine `save` module;
  keep the `beforeunload` session save synchronous (the engine storage API is
  async).
