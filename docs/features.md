# Features

| Feature | Description | Status |
| ------- | ----------- | ------ |
| Pan and zoom camera | Drag to pan; scroll to zoom toward the cursor. | Done (Phase 0) |
| Reference grid | Adaptive world grid and axes for spatial feedback. | Done (Phase 0) |
| FPS HUD | Frame-time / FPS overlay via the engine `stats` module. | Done (Phase 0) |
| Procedural systems | Deterministic star systems generated per sector. | Done (Phase 1) |
| Analytic orbits | Planets orbit their star (closed-form Kepler). | Done (Phase 1) |
| LOD streaming | Zoom-bounded tiers (systems → star dots → density glow) with streaming, floating origin, and tier cross-fades. | Done (Phase 2) |
| Seed persistence | Random world seed minted on first load and saved via the engine `save` module; reload = identical universe, clear storage = new one. | Done (Phase 4 — seed) |
| Naming & player deltas | Deterministic system/star names; visited/named deltas. | Planned (Phase 4) |

Roadmap detail: [plans/procedural-universe.md](plans/procedural-universe.md).
