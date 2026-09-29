# Features

Shipped features. Planned work is in [roadmap.md](roadmap.md).

## Navigation and view

| Feature | Description |
| ------- | ----------- |
| Pan and zoom camera | Left-drag pans; scroll zooms toward the cursor, with rapid scrolls accelerating so the full zoom range is a quick flick. |
| 3D system view | Three.js (WebGPU with WebGL2 fallback) draws each planetary system in 3D — lit rotating spheres and inclined orbits; right-drag orbits and tilts the view. A contextual "Flatten" button snaps straight top-down and back to the prior angle. |
| Renderer choice | Three.js renders every tier and is the default; Canvas 2D is a frozen fallback, used automatically when Three cannot load or initialise and selectable in Options. |
| LOD streaming | Zoom-bounded tiers (systems → star dots → galaxy glow → galaxy field → cosmic web) with sector streaming, a floating render origin, and tier cross-fades. |
| Reference grid | Adaptive world grid and axes for spatial feedback. |
| Scale bar | A map-style bar one grid-cell wide labels the current view scale, auto-selecting km / AU / ly. |
| Coordinate readout | Bottom-left readout of the view-centre world position (auto-scaled AU / ly / kly / Mly) plus the current galaxy and the offset from its centre. |
| Location tree | A top-left panel shows where the camera is as a hierarchy (Universe → Galaxy → System → Planet → Moon), growing as you zoom in. Clicking a node pins it in the inspector; the current selection is highlighted. |
| Camera focus and lock | "Zoom to" in the inspector frames the selected body and its satellites; "Lock" (planets and moons) keeps the body centred while you zoom, releasing on pan, re-select, or zooming out past it. |
| Bookmarks | ☆ in the inspector bookmarks any body, galaxy, or the universe. A bookmark panel offers Zoom-to and Inspect; bookmarks persist with the universe save. |
| Return to origin | A bottom-centre button reframes the home galaxy. |
| FPS HUD | Frame-time / FPS overlay via the engine `stats` module. |

## Universe generation

| Feature | Description |
| ------- | ----------- |
| Deterministic universe | The whole universe is a pure function of the world seed and coordinates; reloading regenerates it identically. |
| Galaxy structure | Galaxies of varied morphology (spiral, barred, elliptical, lenticular, dwarfs) cluster into a cosmic web of filaments and voids; star placement follows each galaxy's density field. |
| Stellar populations | Star colours follow galactic position: star-forming arms skew hot and blue, old cores and elliptical / lenticular galaxies cool and red. |
| Central black holes | Each galaxy hosts a supermassive black hole (M–σ-style mass, Schwarzschild radius, AGN activity), inspectable like any body. |
| Physical star data | Each star's seeded mass (Kroupa IMF) derives luminosity, radius, temperature, spectral class, lifetime, and a blackbody colour. |
| Planet physics | Per-planet mass, type, radius, density, temperatures, atmosphere, rotation, obliquity, rings, and habitability, derived from the seed. |
| Moons | Major moons per planet, with counts that follow planet mass and Hill-sphere size; pickable, inspectable, and listed in the location tree. |
| Keplerian orbits | Elliptical, gently inclined orbits whose period follows the host mass and semi-major axis, faster at periapsis. |
| Realistic scale | AU within systems, light-years between stars; orbital periods are real years. A "usable" body-scale option floors body sizes so they stay visible. |
| Body naming | Deterministic, seed-derived names (human-readable by default, catalogue style in Options), shown in the inspector and as labels that track each body. |

## System visuals (3D)

| Feature | Description |
| ------- | ----------- |
| Star shading | Limb darkening, granulation and spots, gentle flicker, and a bloom corona, all from the star's temperature and size; the star is the scene's point light. |
| Background starfield | A galaxy-aware sky dome whose density and colour follow the local galaxy, with a smooth falloff away from the galaxy plane. |
| Planet rings | Translucent, star-lit rings with a planet-shadow band, colour by temperature, and per-planet gaps, ringlets, and opacity. |
| Oblateness | Fast-rotating planets bulge at the equator. |

## Data, time, and persistence

| Feature | Description |
| ------- | ----------- |
| Body inspector | Click a body to pin a panel of its seed-derived physics, with tooltips and unit conversions; Escape or an empty-space click dismisses. |
| Time controls | Simulation-date readout (epoch 2100-01-01 UTC) and a stepped speed slider from pause up to fast-forward. |
| Options menu | Temperature, distance, and number display units; value mode; detail level; body scale; naming style; renderer. |
| Universe save | Seed, camera view (including 3D orbit angle), sim clock and speed, and bookmarks are saved together; a new universe resets them as a unit. |
| Preferences | Display options persist separately so they survive a new universe. |
