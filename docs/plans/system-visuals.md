# System Tier Visual Overhaul — Roadmap

The **complete** picture for "prettifying" the system view now that the 3D
foundation is done (perspective camera, spheres, Z axis, planet rotation/tilt,
inclined orbits, flatten toggle). This is the umbrella roadmap; individual
focused plans (starting with [star-shading.md](star-shading.md)) implement one
workstream at a time.

This roadmap covers **Stage 2 (shader effects, R2)** and parts of **Stage 4
(sphere surfaces, R3)** of [rendering-backend.md](rendering-backend.md),
narrowed — per Pierre — to the **system tier only**.

> Status: **planning.** Nothing here is implemented yet. The first slice is
> stars ([star-shading.md](star-shading.md)).

## 1. Intent

Make the system view beautiful **without inventing anything** — every visual
must be derivable from the body's already-generated physical data. A star
should look like *that* star (its real temperature, size, age); a planet should
look like *that* planet (its type, temperature, water state, atmosphere,
rings). No hand-painted "artist's impression" that ignores the numbers.

Today the bodies are honest 3D spheres but visually flat: stars are uniform
self-lit discs ("yellow circles"), planets are single flat colours with correct
light/shadow, the sky behind them is empty black.

## 2. Guiding principles

- **Data-driven.** Each effect names the field(s) it reads. If a look needs a
  new number, that number is derived or sampled first (and any new *sampled*
  field appends to a body's draw order to preserve determinism — see the
  realism plans' convention).
- **Procedural, not textured.** Surfaces are generated on the GPU with noise +
  the body's data (TSL shaders, running on WebGPU with the WebGL2 fallback).
  No image assets: infinite variety, and inherently faithful to the data.
- **Purely visual.** None of this touches generation, physics, sim, naming,
  persistence, or determinism. It reads the world; it never writes back.
- **LOD / perf invariant.** On-screen work stays bounded. Real sphere surfaces
  and shaders are for the **near** focused bodies only; distant things stay
  cheap points/sprites, as today.
- **Toggle-friendly.** Where an effect is expensive or a matter of taste, it
  should be gate-able (a setting), matching the existing True/Usable and
  Flatten toggles.

## 3. Workstreams

Each is a self-contained unit of work with its own eventual plan doc. Priority
column: **1 = first focus**, higher = later.

| # | Workstream | Reads | Approach (plain) | Priority |
| - | ---------- | ----- | ---------------- | -------- |
| A | **Star surface shading** | `temperature`, `colorHex`, `luminosity`, `radius` | Limb darkening + blackbody colour + granulation/spots noise + corona glow + gentle flicker. Kills the flat "yellow circle". | **1** ([star-shading.md](star-shading.md)) |
| B | **Realistic star lighting** | star position, `luminosity` | Replace the fixed directional light with a **point light at the star**, so planets/moons are lit on the star-facing hemisphere and the lit face tracks the orbit. Cheap, high value. | **1** (with A) |
| C | **Galaxy-aware background starfield** | `galaxyDensityAt`, `galaxyActivityAt`, `cosmicDensity` | A far-dome procedural starfield whose density + colour follow the local galaxy (dense/bluer in core & arms, sparse in voids), plus a faint Milky-Way band inside a disk. | 2 ✅ ([background-starfield.md](background-starfield.md)) |
| D | **Gas / ice giant surfaces** | `type`, `equilibriumTemp` | Horizontal banded atmosphere (Jupiter/Neptune stripes) coloured by temperature + type. Biggest single planet upgrade. | 2 |
| E | **Rocky / terrestrial surfaces** | `type`, `equilibriumTemp`, `waterState`, `inHabitableZone` | Mottled rocky/cratered surface; colour ramps molten-red → brown/grey → ice-white by temperature; polar ice caps; blue oceans for liquid-water worlds. | 3 |
| F | **Atmospheres (rim glow + clouds)** | `retainsAtmosphere`, `atmosphereType`, `equilibriumTemp` | Soft coloured limb halo ("airglow") on worlds that keep an atmosphere; a thin drifting cloud layer over them. | 3 |
| G | **Rings** | `hasRings`, `obliquity`, plane normal | A translucent ring disc tilted with the planet. Data already exists; rings are (as far as we know) **not drawn yet**. High payoff. | 4 |
| H | **Oblateness (equatorial bulge)** | `rotationPeriod`, oblateness calc | Squash fast-rotators slightly at the equator. Subtle; the sphere is currently perfectly round. | 4 |
| I | **Moon surfaces** | moon `density`, `radius`, host proximity | Small-body look (grey/icy cratered) so moons don't read as mini-planets. | 4 |
| J | **Eclipses / cast shadows** *(advanced, optional)* | geometry | Shadow mapping so a moon dims behind a planet, or a planet shadows its rings. Real, but perf-costly and a subtle payoff at these scales. | 5 |

## 4. Suggested staging

1. **Stars + realistic lighting (A + B).** Fixes the most-noticed problem and
   is the simplest shader; lighting is nearly free and improves every planet.
2. **Background starfield (C).** Removes the "bland black" and is independent
   of the body shaders.
3. **Gas/ice giant bands (D)** — the biggest planet "wow".
4. **Rocky surfaces + water/ice (E)**, then **atmospheres (F)**.
5. **Rings (G)**, **oblateness (H)**, **moon surfaces (I)**.
6. **Eclipses (J)** only if desired later.

## 5. Invariants to preserve

- Generation → sim → render stays one-way; shaders read the ECS world only.
- Determinism untouched (these are visual; no new draws unless a workstream
  explicitly samples a field, appended to preserve the stream).
- Bounded on-screen work: shaders/spheres for near bodies; far tiers stay
  cheap points/sprites.
- Behind the engine `Renderer` seam; Canvas 2D backend unaffected; effects live
  on the Three.js path.
- WebGL2-capability baseline; any WebGPU-compute-only trick is a progressive
  enhancement (per rendering-backend.md §4).

## 6. Open questions

- **Toggles:** which effects get a settings switch vs always-on? (Star glow
  intensity, background density, clouds on/off are candidates.)
- **Ambient light:** real space is near-black on the far side. Keep a small
  ambient fill for readability, or go fully dark for realism (with a toggle)?
- **Background: real vs procedural nearest stars** — worth showing a handful of
  actual nearest bright stars, or is the procedural dome enough? (Leaning: dome
  is enough.)
- **Binary/multi-star systems** — single-star today; if binaries ever land,
  lighting becomes two point lights (noted for later).

## 7. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-04 | Scope | System tier only; prettify existing 3D bodies. |
| 2026-07-04 | Build approach | **Procedural TSL shaders**, no texture assets. |
| 2026-07-04 | First focus | **Stars** (surface shading + glow) — see star-shading.md. |
| 2026-07-04 | Star lighting | Realistic **point light at the star**; do it with the stars work. |
| 2026-07-04 | Eclipses / cast shadows | Real but expensive; **roadmap/optional (J)**, not the first pass. |
| 2026-07-04 | Background sky | **Procedural galaxy-aware starfield dome** (density/colour from galaxy field), not rendering every real neighbour. |
