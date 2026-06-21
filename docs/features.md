# Features

| Feature | Description | Status |
| ------- | ----------- | ------ |
| Pan and zoom camera | Drag to pan; scroll to zoom toward the cursor. | Done (Phase 0) |
| Reference grid | Adaptive world grid and axes for spatial feedback. | Done (Phase 0) |
| FPS HUD | Frame-time / FPS overlay via the engine `stats` module. | Done (Phase 0) |
| Procedural systems | Deterministic star systems generated per sector. | Done (Phase 1) |
| Physical star data | Each star's seeded mass (Kroupa IMF) derives luminosity, radius, temperature, spectral class, lifetime, and a blackbody colour. | Done (Realistic-sim A) |
| Keplerian orbits | Planets trace elliptical orbits; period depends on the host star mass and semi-major axis, faster at periapsis (Kepler II). | Done (Realistic-sim B) |
| Realistic scale | AU within systems, light-years between stars (~10⁵× ratio); orbital periods are real years; a non-physical visual disc keeps bodies visible. | Done (Realistic-sim C) |
| Time controls | Simulation-date readout (epoch 2100-01-01 UTC) and a stepped speed slider (pause → 1 day/s, incl. sub-real-time). | Done (Realistic-sim C — time) |
| LOD streaming | Zoom-bounded tiers (systems → star dots → density glow) with streaming, floating origin, and tier cross-fades. | Done (Phase 2) |
| Seed persistence | Random world seed minted on first load and saved via the engine `save` module; reload = identical universe, clear storage = new one. | Done (Phase 4 — seed) |
| Naming & player deltas | Deterministic system/star names; visited/named deltas. | Planned (Phase 4) |

Roadmap detail: [plans/procedural-universe.md](plans/procedural-universe.md) and
[plans/realistic-simulation.md](plans/realistic-simulation.md).
