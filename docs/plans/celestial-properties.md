# Celestial Properties — Implementation Plan

Add the data catalogued in
[../research/celestial-properties-extensions.md](../research/celestial-properties-extensions.md)
to the inspector, then (later, separately) use it to draw bodies differently.

Source of truth for *what* each property is and *how* to compute it: the research
doc. This plan is the *order of work* and the *engineering constraints*.

## Goal

Enrich every body's inspector panel with more physics, starting with the
zero-cost derivations and working up the confidence ladder
(`FORMULA → INPUT → COND/DIST → ARB`), without breaking the deterministic
universe.

## Guiding decisions

- **`FORMULA` fields cost zero RNG draws.** They are pure functions of fields we
  already store, so they never shift the seeded universe. Implement them as small
  helper functions next to the data (the way `orbitalPeriod`, `habitableZone`,
  and `frostLine` already live in `orbits.ts` / `planets.ts`) and call them from
  the inspector. **No new component fields, no sampler changes, no save impact.**
  - Exception: a few derivations need a gen-time-only input the entity does not
    carry (e.g. a planet does not store its host star's luminosity, which
    insolation needs). For those, store the *derived value* at generation time
    (like `equilibriumTemp` already is) — still zero new draws.
- **Any sampled field shifts the universe.** Appending a new `rng()` draw changes
  every body generated after it. Rules:
  - Append new draws at the **tail** of a body's existing sampling order
    (`sampleStar` / `samplePlanet` / `makeGalaxy`), never between existing draws.
  - **Batch all of a body's planned new draws into one pass** so the universe
    reshuffles once per body, not once per field. This is why Phase 2 folds each
    body's `INPUT` prerequisites and its cheap `DIST` companions together.
  - The world is a pure function of the seed (bodies are regenerated, not saved),
    so new fields need **no save migration** — but the *same seed* will produce a
    *different universe* after a draw-order change. Pierre re-tunes/accepts.
- **Definition of done per field:** unit test green · inspector row renders · the
  property name is prefixed with ✅ in the research doc (so the catalog doubles as
  an implementation tracker).
- **Validation:** `npm run build` (tsc + vite) and `npm test` must pass.
  In-browser verification (does the panel read well, do values look sane) is
  **Pierre's** job per [AGENTS.md](../../AGENTS.md). Each code phase gets a fast,
  lightweight peer-review pass before it is considered done.

---

## Phase 1 — `FORMULA` (free derivations) ← start here

Pure helpers + inspector rows. No draws, no determinism impact. Group by body so
each sub-phase is independently shippable.

### 1.1 Planets ✅

- [x] Add helpers in [src/generation/planets.ts](../../src/generation/planets.ts):
      `surfaceGravity`, `escapeVelocity`, `centralPressure` (Earth-anchored),
      `compositionClass`, `earthSimilarityIndex`. (`hillRadius` / `rocheLimit`
      deferred to the moons/rings work — satellite mechanics, awkward in isolation.)
- [x] Store a derived `insolation` (S⊕) at gen time in `samplePlanet` — no new draw.
- [x] Add the rows to `PlanetPanel` in [src/ui/inspector.tsx](../../src/ui/inspector.tsx).
- [x] Tests in [src/generation/planets.test.ts](../../src/generation/planets.test.ts):
      Earth = 1 g⊕ / 11.19 km/s, ESI(Earth) = 1, composition bins, insolation.
- [x] Mark each shipped property with ✅ in the research doc §3.1.
- Status: build + 104 tests + lint green; not yet committed.

### 1.2 Stars ✅

- [x] Add helpers in [src/generation/stars.ts](../../src/generation/stars.ts):
      `surfaceGravityLog`, `meanDensity`, `escapeVelocity`, `bolometricMagnitude`,
      `peakWavelength`. Expose `habitableZone` / `frostLine` in the panel.
      (`absoluteVisualMagnitude` via a BC(T) table deferred — keeps this cut exact.)
- [x] Add rows to `StarPanel`; tests (Sun: log g = 4.44, ρ = 1.41, v_esc = 617.5,
      M_bol = 4.74, λ_max ≈ 502 nm).
- [x] ✅-mark research doc §2.1.
- Status: build + 108 tests + lint green; not committed.

### 1.3 Orbits ✅

- [x] Add helpers in [src/sim/orbits.ts](../../src/sim/orbits.ts): `periapsis`,
      `apoapsis`, `meanOrbitalSpeed` (km/s), `insolationSwing`. (vis-viva peri/apo
      speeds, specific energy / angular momentum, mean motion, and the two-body
      synodic period deferred — technical, niche for the inspector.)
- [x] Add rows to `PlanetPanel` (orbit section): Peri / Apo, Orbital speed, Flux
      swing; tests for a known ellipse + Earth's 29.8 km/s.
- [x] ✅-mark research doc §4.1.
- Status: build + 112 tests + lint green; not committed.

### 1.4 Black holes ✅

- [x] Add helpers in [src/generation/galaxies.ts](../../src/generation/galaxies.ts):
      `hawkingTemperature`, `evaporationTime`, `photonSphere`,
      `innermostStableOrbit` (ISCO, Schwarzschild), `shadowDiameter`,
      `eddingtonLuminosity`. (`class` is always "supermassive" for our
      10⁶–10¹⁰ M☉ holes; `sphereOfInfluence` / `tidalDisruptionRadius` deferred.)
- [x] Expand `BlackHolePanel` (+6 rows); tests for the per-solar-mass anchors and
      r_s multiples.
- [x] ✅-mark research doc §5.1.

### 1.5 Galaxies + cosmic web ✅

- [x] Add helpers: `velocityDispersion` (invert the M–σ we already use) and
      `environmentClass` (label from `cosmicDensity`, now stored on `GalaxyParams`
      — it was already computed in `makeGalaxy`). (Stellar mass is redundant with
      the shown star count; rotation/Tully–Fisher is type-conditional; redshift is
      ~0 at our galaxy spacing — all deferred.)
- [x] Expand `GalaxyPanel` (Dispersion σ, Environment); tests for the M–σ
      inversion round-trip + the cosmic-web bins.
- [x] ✅-mark research doc §6.1.
- Status: build + 117 tests + lint green; not committed.

---

## Phase 2 — `INPUT` + per-body new draws (determinism shift)

Add new **sampled** fields, batched per body, appended at the tail of each
sampler. Each sub-phase shifts the universe once.

### 2.1 Stars: + `age` (capped), + `metallicity` ✅

- [x] Extend `StarPhysical` + `sampleStar` (append 2 draws after mass: age then
      metallicity); `spawn` writes the whole object so it propagates. Age =
      `Uniform[0, min(lifetime, 13.8 Gyr)]` (the v1 bug fix); metallicity from a
      one-draw normal-quantile approximation. **Shifts the seeded universe** —
      each star keeps its identity (mass is still drawn first, so luminosity /
      class / colour / name are unchanged) but its planets move (the two new
      draws push everything sampled after the star down the per-system stream).
- [x] `INPUT`: evolutionary phase = `age / lifetime`, shown as "MS elapsed %".
      Inspector rows (Metallicity, Age, MS elapsed) + tests (3-draw count, age
      cap, metallicity spread).
- Status: build + 119 tests + lint green; not committed.

### 2.2 Planets: + `rotation`, + `obliquity`, + `moonCount`, + `ringFlag` ✅

- [x] Extend `PlanetPhysical` + `samplePlanet` (now consumes 5 draws: mass,
      rotation, tilt, moons, rings; `samplePlanet` also takes the host star's mass
      + age for tidal locking). Shifts the seeded universe again (planets move;
      stars unaffected). `pick.test.ts` literal updated.
- [x] `INPUT`: oblateness `f` (the "circularity", Jupiter ≈ 6.5%) + tidal-lock flag
      (locked ⇒ rotation = orbital period). Inspector rows (Rotation [· locked],
      Oblateness, Axial tilt, Moons [· rings]) + tests. (Solar day and a separate
      season-strength metric deferred — rotation and obliquity are shown directly.)
- Status: build + 122 tests + lint green; not committed.

### 2.3 Black holes: + `spin` ✅

- [x] Add `blackHoleSpin` (sampled as a trailing draw in `makeGalaxy`, so it's
      **determinism-safe** — galaxies are byte-identical, just a new field),
      threaded through `BlackHolePhysical` / `BlackHoleData` / spawn. `INPUT`:
      `innermostStableOrbit` is now spin-aware (Kerr, Bardeen 1972 — 3·r_s at
      a*=0 down to ~0.5·r_s at a*→1). BlackHolePanel +Spin row; tests.
- Status: build + 123 tests + lint green; not committed. **Completes Phase 2.**

---

## Phase 3 — `COND` (relations, mostly no new draws)

- [ ] Metallicity → giant-planet richness (gate the planet-mass sampler by
      `[Fe/H]`).
- [ ] Has-atmosphere (cosmic shoreline) → atmosphere type → greenhouse surface
      temperature.
- [ ] Magnetic field (dynamo scaling), star variability flag, rotation→activity.
- [ ] Galaxy: SFR, mass–metallicity, mean age, gas fraction, satellite count.
- [ ] Black hole: AGN-active flag from Eddington ratio.
- [ ] **Universe age `T_univ` (cross-cutting global knob).** Draw once per seed
      via an independent hash; thread into the stellar age cap, a metallicity
      offset, planet abundance, and galaxy colour/morphology. Fixed at 13.8 Gyr
      until then. See research-doc §7.1.

---

## Phase 4 — `ARB` (deferred, flavour only)

- [ ] Core temperature, absolute surface pressure, geology/cratering, "inhabited"
      flag. Sample within plausible ranges, label illustrative. Decide later.

---

## Later (separate feature): render bodies from the data

Out of scope here — see research-doc §9 rendering hooks (oblateness → squash the
disc, composition+temperature → colour, rings, tidal-lock terminator, atmosphere
halo, AGN jet, galaxy inclination). Plan that as its own pass once the data exists.
