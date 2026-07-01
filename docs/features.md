# Features

| Feature | Description | Status |
| ------- | ----------- | ------ |
| Pan and zoom camera | Drag to pan; scroll to zoom toward the cursor, with rapid scrolls accelerating so the full zoom range is a quick flick. | Done (Phase 0) |
| Reference grid | Adaptive world grid and axes for spatial feedback. | Done (Phase 0) |
| Scale bar | A map-style bar one grid-cell wide labels the current view scale, auto-selecting km / AU / ly. | Done (zoom-and-scale) |
| Coordinate readout | Bottom-left readout of the view-centre world position (auto-scaled AU / ly / kly / Mly) plus the current galaxy and the offset from its centre. | Done (Realistic-sim G) |
| FPS HUD | Frame-time / FPS overlay via the engine `stats` module. | Done (Phase 0) |
| Procedural systems | Deterministic star systems generated per sector. | Done (Phase 1) |
| Galaxy structure | Many galaxies of varied morphology (spiral, barred, elliptical, lenticular, plus dwarfs) cluster into a cosmic web of filaments and voids (dense clusters skew red and spheroidal); star placement follows each galaxy's density field. Zooming out resolves them into labelled, clickable galaxy sprites (a panel shows morphology, diameter, star estimate, and the central black hole), then the cosmic-web glow. | Done (Realistic-sim E/G) |
| Stellar populations | Star colours follow galactic position: star-forming spiral arms skew hot and blue, old cores and elliptical / lenticular galaxies cool and red; the galaxy glow is tinted to match. | Done (Realistic-sim G) |
| Central black holes | Each galaxy hosts a central supermassive black hole (M–σ-style mass, Schwarzschild radius) shown as a marker at its core and inspectable like any other body. | Done (Realistic-sim G) |
| Physical star data | Each star's seeded mass (Kroupa IMF) derives luminosity, radius, temperature, spectral class, lifetime, and a blackbody colour. | Done (Realistic-sim A) |
| Keplerian orbits | Planets trace elliptical orbits; period depends on the host star mass and semi-major axis, faster at periapsis (Kepler II). | Done (Realistic-sim B) |
| Realistic scale | AU within systems, light-years between stars (~10⁵× ratio); orbital periods are real years; a non-physical visual disc keeps bodies visible. | Done (Realistic-sim C) |
| Planet physics | Per-planet mass, type, radius, density, equilibrium temperature, and habitability derived from the seed; geometric (Titius–Bode) spacing. | Done (Realistic-sim D) |
| Time controls | Simulation-date readout (epoch 2100-01-01 UTC) and a stepped speed slider (pause → 1 day/s, incl. sub-real-time). | Done (Realistic-sim C — time) |
| LOD streaming | Zoom-bounded tiers (systems → star dots → density glow) with streaming, floating origin, and tier cross-fades. | Done (Phase 2) |
| Seed persistence | A random world seed is minted on first load and saved as part of the universe save; reload regenerates the identical universe, clearing storage yields a new one. | Done (Phase 4 — seed) |
| Session & preference persistence | The camera view and the sim clock + speed are saved alongside the seed (a reload resumes exactly; a new universe resets them as a unit), while display preferences like the temperature unit persist separately so they survive a seed reset. A bottom-centre "Return to origin" button reframes the home galaxy. | Done |
| Body inspector | Click a star or planet to pin a panel of its seed-derived physics; planets also show their orbital period in convenient units (s / min / h / days / yr), and clicking any temperature switches every reading between K and °C (remembered across reloads). A four-arrow reticle locks the body and tracks it as it orbits. Escape or an empty-space click dismisses. | Done (Phase F) |
| Camera focus & lock | "Zoom to" button in the inspector frames the selected body plus its satellites; "Lock" (planets and moons only) holds the body at the view centre every frame — you can zoom in/out while the body stays pinned, and the lock releases the moment you pan, re-select, or zoom out past the body. | Done |
| Location tree | A top-left panel shows where the camera is as a hierarchy (Universe → Galaxy → System → Planet), growing as you zoom in and hiding levels you have not reached. Clicking any node pins it in the inspector — including the Universe (seed, age, home galaxy); the node matching the current selection is highlighted. | Done (Tree view) |
| Body naming | Deterministic, seed-derived catalogue names (spectral-class prefix + base-36 id; planets lettered from `b`), shown as the inspector title and as labels that track each body. | Done (Realistic-sim H) |
| Player deltas | Visited / named overrides persisted via the engine `save` module. | Planned (Phase 4) |

Roadmap detail: [plans/procedural-universe.md](plans/procedural-universe.md) and
[plans/realistic-simulation.md](plans/realistic-simulation.md).
