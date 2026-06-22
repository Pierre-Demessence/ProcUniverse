# Realistic Simulation — Design & Plan

Upgrade ProcUniverse so its **data** obeys real astrophysics, derived
deterministically from the seed: stellar mass → luminosity/radius/temperature/
colour/type, Kepler ellipses with correct periods, planet mass/type/temperature/
habitability, and a true astronomical **distance scale** (AU within systems,
light-years between them).

Physics, formulas, constants, and the feasibility analysis live in the research
reference: [../research/realistic-simulation.md](../research/realistic-simulation.md).
This document is the **design + phased checklist**.

> **Sequencing:** this is scheduled **after**
> [procedural-universe.md](procedural-universe.md) reaches a stopping point
> (it is still mid-flight). Research/design now; implement later. Nothing here
> should be started before that hand-off.

---

## 1. Goals and non-goals

### Goals

- Replace arbitrary constants and the random colour palette with **derivations
  from one seeded stellar mass**.
- Real **scale**: orbital distances in AU, interstellar distances in light-years,
  with the true ~10⁵× ratio between them.
- Elliptical, mass-correct orbits.
- Rich per-body **data** (mass, temperature, type, habitability…) computed once
  from the seed and cached.
- **Universe, not a single field**: many galaxies (each with a shape/density and a
  central black hole), structured hierarchically so the layer is additive
  (research §6). Build one galaxy first; wrap into a universe next.
- **Eliminate the grid look** — stars placed by a galaxy density field, not a
  jittered lattice (in v1).
- **Inspect anything** — click a body to read its derived data (stars/planets/moons
  in v1; bigger bodies later).
- **Runtime knobs** — time-scale, scale fidelity, and stellar density are live
  settings, not hard-coded constants.

### Non-goals (v1 of this work)

- No new *visuals* required — exaggerated disc sizes stay; only **colour** becomes
  physical. A later pass designs the visual-size mapping and any new art.
- No N-body gravity (analytic Kepler only).
- No planet-surface view.
- Stellar evolution/remnants, binary systems, moons, asteroid/Kuiper belts and
  rings — wanted eventually, but deferred to post-v1 phases.
- The **universe** layer (multiple galaxies + SMBHs + cosmic tiers) is
  designed-for now but implemented as the milestone **after** the single-galaxy
  v1 (see Phase G).

---

## 2. Core design decisions

### 2.1 Separate three layers explicitly

| Layer | Units / form | Source | Mutable? |
| ----- | ------------ | ------ | -------- |
| **Physical data** | SI / astronomical (kg, K, L☉, AU, km) | pure seed functions | never |
| **World position** | floating-origin local frame (AU within a system; integer sector index + offset between systems) | derived each frame from elements + clock | per frame |
| **Visual** | pixels; **non-physical** disc radius + physical blackbody colour | render time | per frame |

Keeping physical size out of the render path is what makes real distances usable
(see research §2.3). Physical radius is *data*; the drawn disc uses a separate
`visualRadius` mapping (e.g. `clamp(base + k·log(R/R_ref), min, max)`).

### 2.2 Unit system

- **Within a system:** AU for distances, M☉/R☉/L☉ for stars, M⊕/R⊕ for planets,
  Kelvin for temperatures, years for periods. A `units.ts` module holds the
  constants (σ, T_⊙, AU↔km, AU↔ly, …) from the research reference.
- **Between systems:** integer **sector index** `(sx, sy)` + a float offset; one
  sector spans a tunable number of light-years (sets stellar areal density).
- A small set of conversion helpers bridges the two scales for rendering.

### 2.3 Everything is a one-time seed function

A star is fully described by its **mass**; the rest is derivation
(research §3). Generation draws rolls in a fixed order so regenerating a cell is
byte-identical — extending the guarantee the current `generateSectorData` test
already asserts.

### 2.4 Floating origin, extended

The existing sector-rebasing ([src/main.ts](../../src/main.ts)) already keeps
rendered coordinates small. Add a **star-local frame** at the system tier:
rebase the render origin to the focused star so planet coordinates are ≤ tens of
AU (nanometre precision). Between systems, continue rebasing on the sector grid.

### 2.5 Runtime time-scale (zero perf cost)

Because every position is a pure function of a clock `t`, a **runtime time-scale
slider** is trivial and costs nothing — it only changes the number fed to the
orbit function, not the work done. One caveat for smoothness: accumulate a
running `simSeconds += dt · timeScale` **per frame** rather than computing
`simSeconds = wallClock · timeScale`, so moving the slider changes the *rate*
without a position jump. Default to "realistic"; the user can slam it to fast.

### 2.6 Centralised knobs: scale fidelity & density

The preference — "start realistic, expose a single setting, tune later" — is
achievable **iff** the relevant mapping is centralised in one place:

- **Scale fidelity:** route every world→screen distance through one module. Its
  default is identity (true scale); a `scaleCompression` parameter applies an
  optional monotonic non-linear remap (preserves ordering, shrinks gaps for
  approachability). One module, one parameter.
- **Stellar density:** a single `LY_PER_SECTOR` (+ occupancy fraction) constant
  sets how far apart stars are. Literally one number to tune.

Build both as knobs from day one with realistic defaults; tuning for "appeal"
later is then a value change, not a refactor.

### 2.7 Hierarchical universe (design for N levels, ship one galaxy)

Coordinates, seeding, and LOD are designed to nest (research §6): universe →
galaxy → star sector → system. Addressing is hierarchical
(`galaxy index → sector index → offset`); each level's seed derives from the one
above (`hashGalaxy → hashSector → system RNG`). The v1 implementation fills **one
galaxy**; the universe layer (many galaxies, central black holes, cosmic tiers)
drops in additively (Phase G) because every level reuses the same streaming +
floating-origin machinery.

---

## 3. Component & module model

New/changed pieces (engine components via `simpleComponent`, like the existing
`OrbitDef`):

| Piece | Shape (data) | Replaces / extends |
| ----- | ------------ | ------------------ |
| `units.ts` | constants + conversions | new |
| `StarPhysical` | `mass, luminosity, radius, temperature, spectralClass, colorHex, lifetime` | derived; colour replaces the random palette pick |
| `OrbitElements` | `a, e, argPeriapsis, meanAnomaly0, starMass` | **replaces** `Orbit { cx, cy, a, omega, phase }` |
| `PlanetPhysical` | `mass, radius, type, density, equilibriumTemp, inHabitableZone, …` | new |
| `generation/stars.ts` | IMF sampler + mass→L,R,T→colour/type chain | new (consumes hash/rng) |
| `generation/planets.ts` | spacing, mass, type, radius, T_eq, HZ flags | extends `universe.ts` |
| `sim/orbits.ts` | Kepler-equation solver; period from `starMass`,`a` | rewrite `updateOrbits` |
| `render/*` | `visualRadius` mapping; colour from `StarPhysical` | additive |

Universe-layer pieces (Phase G; designed-for now, built later): `GalaxyData`
(`type, shape/density params, centralBlackHoleMass`), a `BlackHole` component,
`generation/galaxies.ts` (hierarchical `hashGalaxy` + a galaxy density field that
*conditions* star placement), and the two extra LOD tiers. An `Inspector` overlay
(Phase F) reads `StarPhysical` / `PlanetPhysical` for the picked body.

`SystemData` / `PlanetData` in
[src/generation/universe.ts](../../src/generation/universe.ts) grow the physical
fields; `spawnSector` writes the new components.

---

## 4. Phased plan

Each phase is independently shippable and leaves the app runnable. Static checks
(typecheck/lint/test/build) **and** a browser E2E pass gate every phase (the
render loop hides regressions that static checks miss).

### Phase A — Stellar data model (no motion/scale change yet)

- [x] `units.ts`: constants + conversions (σ, T_⊙, L_⊙, AU↔km, AU↔ly).
- [x] `generation/stars.ts`: IMF mass sampler (Kroupa broken power law, inverse
      CDF) → `L, R, T` (piecewise relations + Stefan–Boltzmann) → spectral class
      bin.
- [x] Blackbody colour: port Mitchell Charity `bbr_color` anchors + interpolation;
      colour = `blackbody(T)`.
- [x] `StarPhysical` component; `SystemData` carries the physical fields;
      `spawnSector` writes them; renderer reads `colorHex` (drop the random
      palette).
- [x] Tests: determinism (regeneration identical); sanity (1 M☉ → ~5600–5900 K,
      ~G class; sampled population skews ~M-dwarf-heavy per the IMF).
- [x] Browser E2E: systems still render; star colours now track temperature.

### Phase B — Real orbital mechanics

- [x] `OrbitElements` (`a, e, argPeriapsis, meanAnomaly0, starMass`) replacing
      `Orbit`.
- [x] Kepler solver (Newton, 3–5 iters) + period `P = sqrt(a³/M_star)`,
      `n = 2π/P`; elliptical position in `updateOrbits` (in-place writes, as now).
- [x] Seed `e` (mostly small), `argPeriapsis`, `meanAnomaly0` per planet; orbit
      rings drawn as ellipses.
- [x] Tests: closed orbit returns to start after one period; faster at periapsis
      (Kepler II); period ratio matches `sqrt(a³/M)`.
- [x] Browser E2E: planets visibly trace ellipses; inner/low-`a` planets faster;
      heavier stars spin planets faster at equal `a`.

### Phase C — Realistic scale, coordinate model & runtime knobs

- [x] Adopt AU within systems and ly-per-sector between systems; retune
      `SECTOR_SIZE`, zoom range (`MIN/MAX_ZOOM`), and tier thresholds for the
      ~10⁵× orbital-vs-interstellar ratio.
- [x] Star-local floating origin at the system tier (rebase to focused star).
      *(Required after all: the engine draws each disc's `arc()` at its local
      world coordinate, and the canvas loses path precision at ~10⁵ AU, so discs
      rendered as jagged "potatoes" and star strokes as scribbles until the
      origin was moved onto the focused star — `nearestStar` in `main.ts`.)*
- [x] `visualRadius` mapping (decouple drawn disc size from physical radius);
      keep bodies visible without distorting positions. *(Stars derive their
      disc from physical R☉ via `scale.starVisualRadius`; planets keep an AU
      placeholder until Phase D gives them a physical radius.)*
- [x] Centralise world→screen distance in one module (`src/scale.ts`) with a
      single `LY_PER_SECTOR` density constant. *(A `scaleCompression` remap is
      deferred — default identity = no behaviour; the hook lands when we tune
      for appeal.)*
- [x] Runtime time-scale: accumulate `simSeconds += dt·timeScale`; expose a slider
      (discrete preset steps: pause · 0.25× … 1 day/s, default 1×). Includes a
      human-readable **sim-date** readout (epoch 2100-01-01 UTC = second 0).
- [x] Validate: no positional jitter when zoomed onto a planet far from origin;
      bounded draw count preserved across the (now larger) zoom range.
- [ ] Emptiness mitigations: confirm LOD aggregates fill the field on zoom-out;
      add accelerating zoom. *(Accelerating/momentum zoom deferred to a follow-up;
      the full range is ~10¹² so traversal is many wheel-notches until then.)*
- [x] Browser E2E: zoom from a planet out to neighbouring stars; verify the gap
      is large, the aggregates fill in, the time slider works, and 60+ fps holds.

### Phase D — Planet physics

- [x] Frost line `a_frost ≈ 2.7·sqrt(L)` AU; habitable zone bounds `∝ sqrt(L)`.
- [x] Per planet: sample mass; type by mass + (`a` vs. frost line); radius via
      Forecaster/Zeng mass–radius; density; `T_eq`; `inHabitableZone` and
      water-state flags.
- [x] Geometric (Titius–Bode-ish) spacing; seeded planet count. *(Optional
      Hill-stability nudge skipped for now.)*
- [x] `PlanetPhysical` component written by `spawnSector`; the drawn planet disc
      now derives from the physical radius (`scale.planetVisualRadius`).
- [x] Tests: Earth-like inputs (1 L☉, 1 AU, A≈0.3) → `T_eq ≈ 255 K`; HZ brackets
      ~1 AU for the Sun; gas giants land beyond the frost line.
- [x] Browser E2E: inspecting systems shows plausible, varied planet data.
      *(Visible now: geometric spacing + type-scaled planet sizes; reading the
      numeric data needs the Phase F inspector.)*

### Phase E — Galaxy placement (eliminate the grid) — in v1

- [x] Replace the jittered lattice with placement driven by a **galaxy density
      field** (per-sector rejection sampling = inhomogeneous Poisson; denser in
      arms / core; finite radius). Detail: [galaxy-placement.md](galaxy-placement.md).
- [x] Pick a galaxy shape (spiral / elliptical) as a seeded per-galaxy property
      (`generation/galaxies.ts`); condition star placement on the density there.
- [x] The galaxy-tier glow samples the same field, so the zoomed-out view shows
      the galaxy's core and arms.
- [x] Browser E2E (Pierre): the field no longer looks like a lattice; density
      varies with galactic position.

### Phase F — Inspector overlay — in v1

- [x] Pick-at-cursor → data panel showing the picked body's derived properties
      (star: mass/L/R/T/class; planet: mass/radius/type/Teq/habitability).
- [x] Hit-testing across tiers; extensible to moons / black holes / aggregates
      later.
- [x] Browser E2E: click a star and a planet; verify the panel reads plausible,
      seed-stable data.

### Phase G — Galaxy & universe hierarchy

Split into **G1** (many galaxies + black holes, reusing the existing tiers) and **G2** (dedicated
aggregate tiers + cosmic web). Detail: [universe-hierarchy.md](universe-hierarchy.md).

**G1 — many galaxies + black holes — DONE**

- [x] `hashGalaxy(seed, gx, gy)` + a galaxy grid (`makeGalaxy` / `galaxyAt` / `galaxyDensityAt`);
      morphology spiral / barred / elliptical / lenticular (+ a dwarf size roll) by realistic field
      fractions; a home galaxy at the origin keeps startup populated. Absolute coordinates on the
      compressed scale, so the existing sector cache / streamer / tiers are reused unchanged.
- [x] `BlackHole` component + a central SMBH (M–σ-style mass, Schwarzschild radius) at each galaxy
      centre, spawned as a marker and pickable with an inspector panel.
- [x] Position-based stellar populations: spiral arms bias to hot-blue stars, old cores /
      ellipticals to cool-red; the zoomed-out glow is tinted to match.
- [ ] Browser E2E (Pierre): fly between galaxies; varied morphologies + colours; inspect a black hole.

**G2a — galaxy-field tier + galaxy inspection — DONE**

- [x] A `galaxy-field` LOD tier (each galaxy a tinted sprite + `NGC-…` label) and a `universe`
      backstop tier (the aggregation glow), inserted into the five-tier zoom selector.
- [x] Galaxy picking + a galaxy inspector panel (morphology, diameter, estimated star count, dominant
      population colour, central black-hole mass).
- [ ] Browser E2E (Pierre): galaxies as labelled sprites; click one to inspect it.

**G2b — cosmic web (deferred)**

- [ ] Cosmic-web clustered galaxy placement (the morphology–density relation) + a distinct universe
      visual.
- [ ] Irregular galaxies (the deferred 5th morphology).
- [ ] Only if realistic galaxy sizes are ever wanted: galaxy-relative hierarchical addressing.

### Phase H — Identity & naming

Names are pure functions of the seed (world seed → sector → cell → orbital
order) plus the star's spectral class, so **nothing is persisted** — a
regenerated sector reproduces identical names. This resolves the naming half of
`procedural-universe.md` Phase 4 (player deltas remain its only deferred item).

- [x] `hashSystem(seed, sx, sy, gx, gy)` — a per-system uint32 independent of the
      generation rng stream, so deriving a name never perturbs the physics draws.
- [x] `naming.ts`: `nameStar` (spectral-class prefix + base-36 catalogue number,
      e.g. `G-4F2A9`) and `namePlanet` (exoplanet letters: innermost = `b`),
      plus a `NameDef` identity component.
- [x] `generateSectorData` writes `SystemData.name` / `PlanetData.name`;
      `spawnSector` attaches `NameDef` to every star and planet entity.
- [x] Inspector panel shows the name as its title.
- [x] Body labels rendered next to each body at the system tier
      (`render/draw-labels.ts`), tracking it in screen space so a planet's name
      follows it along its orbit.
- [x] Tests: catalogue format, class prefix, planet lettering, `hashSystem`
      variation/determinism, and seed-stable names in `generateSectorData`.
- [x] Browser E2E (Pierre): names legible and well-placed; planet labels follow
      orbits; HUD title matches the on-canvas label.
- [ ] Galaxy fold-in: once Phase G lands, mix the galaxy index into `hashSystem`
      so names are tied to the galaxy as well as the sector.

---

## 5. Risks & watch-points

- **`erasableSyntaxOnly` tsconfig**: no enums / parameter properties / namespaces;
  spectral class as a string-union + explicit field assignment in constructors
  (see repo memory). Type-only imports must be `import type`.
- **Determinism**: keep a fixed RNG draw order; the determinism test must cover
  the new fields, not just positions.
- **Hot-path cost**: Kepler Newton iterations and `T_eq`/colour are per-body —
  compute physical data **once at spawn** (cache on the component), not per frame.
  Only the orbital *position* is per-frame.
- **Precision**: validate the star-local rebase actually removes jitter at the
  deepest zoom far from origin (the whole point of §2.4).
- **Scope creep**: v1 is Phases A–F (realistic data + real placement + inspector).
  The **universe** layer (Phase G) and further realism (stellar evolution,
  binaries, belts, moons) are deliberately separate milestones — keep them out of
  v1 even though the design accommodates them.
- **Hierarchy precision**: with nested levels, validate floating origin at *each*
  level (rebase to galaxy, then sector, then star) so deep zoom far from the
  universe origin stays jitter-free.

---

## 6. Resolved decisions & remaining questions

Decisions (from review):

1. **Time-scale** — a **runtime slider** (accumulate `simSeconds`; default
   realistic). Pure functions → zero perf cost (§2.5).
2. **Scale fidelity** — **true scale by default**, with a centralised distance
   module + `scaleCompression` parameter to tune for appeal later (§2.6).
3. **Stellar density** — a single `LY_PER_SECTOR` constant, realistic default,
   tuned later (§2.6).
4. **v1 scope** — through **Phase F** (data, orbits, scale, planets, real galaxy
   placement, inspector). No more grid look. Universe = next milestone (Phase G).
5. **Inspection** — a runtime overlay: click a body → data panel (stars/planets in
   v1; moons / black holes / clusters / galaxies later).

Still to confirm before building Phase G (universe):

- **Galaxy density target** — how many galaxies / how far apart (one knob, like
  stellar density)?
- **Galaxy types** — which shapes first (spiral + elliptical is a good minimal
  pair)?
- **Black holes** — include the central SMBH as an inspectable body in the first
  universe pass, or shape / aggregate only at first?

---

## 7. Validation strategy

- **Determinism test** per phase: regenerate a cell, assert identical entity set
  *including* new physical fields.
- **Physics sanity tests**: Sun-like inputs reproduce known numbers (G2, ~5772 K,
  `T_eq ≈ 255 K` at 1 AU); IMF population skews M-dwarf-heavy; mass–radius and
  HZ brackets match the reference table.
- **Browser E2E** per phase (static checks are necessary but not sufficient for a
  real-time renderer): exercise zoom across tiers, orbit motion, and — for Phase
  C — the precision/emptiness behaviour, before calling a phase done.
- **Inspector & hierarchy** (Phases F–G): click-to-read returns seed-stable data;
  precision holds when rebasing across galaxy → sector → star far from the origin.
