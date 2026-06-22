# Features

| Feature | Description | Status |
| ------- | ----------- | ------ |
| Pan and zoom camera | Drag to pan; scroll to zoom toward the cursor, with rapid scrolls accelerating so the full zoom range is a quick flick. | Done (Phase 0) |
| Reference grid | Adaptive world grid and axes for spatial feedback. | Done (Phase 0) |
| Scale bar | A map-style bar one grid-cell wide labels the current view scale, auto-selecting km / AU / ly. | Done (zoom-and-scale) |
| FPS HUD | Frame-time / FPS overlay via the engine `stats` module. | Done (Phase 0) |
| Procedural systems | Deterministic star systems generated per sector. | Done (Phase 1) |
| Galaxy structure | Stars are placed by a seeded galaxy density field — a finite spiral (core + logarithmic arms) or elliptical disc — instead of a lattice; the zoomed-out glow shows the same shape. | Done (Realistic-sim E) |
| Physical star data | Each star's seeded mass (Kroupa IMF) derives luminosity, radius, temperature, spectral class, lifetime, and a blackbody colour. | Done (Realistic-sim A) |
| Keplerian orbits | Planets trace elliptical orbits; period depends on the host star mass and semi-major axis, faster at periapsis (Kepler II). | Done (Realistic-sim B) |
| Realistic scale | AU within systems, light-years between stars (~10⁵× ratio); orbital periods are real years; a non-physical visual disc keeps bodies visible. | Done (Realistic-sim C) |
| Planet physics | Per-planet mass, type, radius, density, equilibrium temperature, and habitability derived from the seed; geometric (Titius–Bode) spacing. | Done (Realistic-sim D) |
| Time controls | Simulation-date readout (epoch 2100-01-01 UTC) and a stepped speed slider (pause → 1 day/s, incl. sub-real-time). | Done (Realistic-sim C — time) |
| LOD streaming | Zoom-bounded tiers (systems → star dots → density glow) with streaming, floating origin, and tier cross-fades. | Done (Phase 2) |
| Seed persistence | Random world seed minted on first load and saved via the engine `save` module; reload = identical universe, clear storage = new one. | Done (Phase 4 — seed) |
| Body inspector | Click a star or planet to pin a panel of its seed-derived physics; planets also show their orbital period in convenient units (s / min / h / days / yr), and clicking any temperature switches every reading between K and °C. A four-arrow reticle locks the body and tracks it as it orbits. Escape or an empty-space click dismisses. | Done (Phase F) |
| Body naming | Deterministic, seed-derived catalogue names (spectral-class prefix + base-36 id; planets lettered from `b`), shown as the inspector title and as labels that track each body. | Done (Realistic-sim H) |
| Player deltas | Visited / named overrides persisted via the engine `save` module. | Planned (Phase 4) |

Roadmap detail: [plans/procedural-universe.md](plans/procedural-universe.md) and
[plans/realistic-simulation.md](plans/realistic-simulation.md).
