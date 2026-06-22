# Celestial Properties — Extension Research

Additional data we could compute for **every** celestial body — stars, planets,
orbits, black holes, galaxies, the cosmic web, and future bodies (moons,
remnants) — beyond what `StarPhysical` / `PlanetPhysical` / `OrbitElements` /
`GalaxyParams` / `BlackHolePhysical` currently expose. The goal is to enrich the
inspector now, and later to **draw bodies differently** from these fields (see
[§9](#9-rendering-hooks-drawing-bodies-from-the-data)).

Every entry states **how confidently we can generate it**, the computation or
distribution, the observational basis, and whether a **new RNG draw** is needed
(a new draw inserted mid-stream shifts the deterministic universe — see
[§0.2](#02-seed-stability-the-draws-column)).

This extends [realistic-simulation.md](./realistic-simulation.md); it reuses the
constants in [src/generation/units.ts](../../src/generation/units.ts) and the
existing derivations in [src/generation/stars.ts](../../src/generation/stars.ts),
[planets.ts](../../src/generation/planets.ts),
[galaxies.ts](../../src/generation/galaxies.ts), and
[src/sim/orbits.ts](../../src/sim/orbits.ts).

---

## 0. How to read this document

### 0.1 The confidence classes

Every property is tagged with **how honestly we can generate a value**, matching
the five tiers requested:

| Tag | Meaning | Example |
| --- | --- | --- |
| **`FORMULA`** | A known deterministic computation from fields we **already store**. Zero new randomness. | Surface gravity `g = M/R²` |
| **`INPUT`** | A known **exact formula**, but it needs one new *sampled* input we don't store yet (so the formula is certain; only its input is rolled). | Oblateness needs a rotation rate; tidal-lock needs stellar age |
| **`COND`** | No closed form, but a **real statistical relation** to another property is observed, so we draw it from a distribution *conditioned* on that property ("if A is X, B is likely Y"). | Giant-planet rate vs. metallicity; "has atmosphere" via the cosmic shoreline |
| **`DIST`** | Effectively **independent** of our other fields, but enough real observations exist to justify a standalone plausible random distribution. | Stellar metallicity spread; black-hole spin |
| **`ARB`** | Genuinely **not understood / too complex** to model faithfully. Only full random or an aesthetic/arbitrary formula is honest. | Absolute surface pressure; surface cratering; "is it inhabited" |

A property can shift tier as we add fields: e.g. **core temperature** is `ARB`
in isolation but becomes a weak `COND` once mass + age exist.

### 0.2 Seed stability (the "Draws" column)

The universe is a pure function of the seed; physics is sampled from an ordered
`rng()` stream (see [galaxies.ts](../../src/generation/galaxies.ts) `makeGalaxy`
and [stars.ts](../../src/generation/stars.ts) `sampleStar`). **Inserting a new
draw mid-stream changes every body generated after it.** So each sampled
property notes its cost (`+1` draw, etc.), and the safe rule is: **append new
draws at the end** of a body's sampling order, never between existing ones.
`FORMULA` properties are free and reorder-proof — prefer them.

---

## 1. Fact-check of the v1 draft

The original three sections were **sound**; corrections below, worst first.

- **❌ Stellar age `Uniform[0, lifetime]` is wrong for low-mass stars.** An
  M-dwarf main-sequence lifetime is `10¹²–10¹³ yr`, so `[0, lifetime]` would
  manufacture stars **older than the universe**. Cap it: `age ~
  Uniform[0, min(lifetime, T_universe)]` with `T_universe ≈ 13.8 Gyr`. Also, a
  realistic disk star-formation history is *mildly weighted to old* ages (the
  past SFR was higher), so any bias should lean **old**, not young. This is the
  one real bug. See [§2](#2-stars) `Age`.
- **⚠ Metallicity Gaussian is slightly off-shape.** The solar-neighbourhood
  metallicity distribution peaks near `[Fe/H] ≈ 0.0` (not −0.1) and is
  **left-skewed** (a tail to metal-poor). A skew-normal (or μ ≈ 0.0, σ ≈ 0.2) is
  marginally more faithful; a plain Gaussian is acceptable. (GALAH DR3, APOGEE.)
- **⚠ Axial tilt range is `[0°, 180°]`, not `[0°, 90°]`,** because retrograde
  tilts exist (Venus 177°, Uranus 98°). And it's worth keeping rather than
  skipping — tilt drives seasons and a visible pole orientation.
- **⚠ "Mean orbital velocity `2πa/P`" is the `e→0` value.** The exact
  time-averaged speed carries a `(1 − e²/4 − …)` correction; more useful, the
  **vis-viva** law gives exact peri/apo speeds (see [§4](#4-orbits)).
- **✓ Confirmed correct:** surface gravity `M/R²`; bolometric magnitude
  `4.74 − 2.5·log₁₀L` (IAU 2015 zero point); escape velocity `√(M/R)`;
  insolation `L/a²`; the tidal-locking timescale
  `T_lock ∝ a⁶·M_p/(M_*²·R_p³)` (matches the Gladman et al. 1996 / Peale form,
  the constant absorbing the tidal `Q`, Love number `k₂`, and initial spin);
  the metallicity → giant-planet-rate link (Fischer & Valenti 2005); and moon
  count as a type-conditioned Poisson (basis thin but defensible).

---

## 2. Stars

Stored today: `mass, radius, luminosity, temperature, spectralClass, colorHex,
lifetime` ([stars.ts](../../src/generation/stars.ts)).

### 2.1 `FORMULA` — free, from existing fields

| Property | Computation (solar units unless noted) | Basis | Draws |
| --- | --- | --- | --- |
| **✅ Surface gravity** | `g = g☉·M/R²`; `log g_cgs = 4.438 + log₁₀M − 2·log₁₀R` | Newtonian | 0 |
| **✅ Mean density** | `ρ = 1.408 g/cm³ · M/R³` | Newtonian | 0 |
| **✅ Escape velocity** | `v_esc = 617.5 km/s · √(M/R)` | Newtonian | 0 |
| **✅ Bolometric magnitude** | `M_bol = 4.74 − 2.5·log₁₀L` | IAU 2015 | 0 |
| **Absolute visual mag.** | `M_V = M_bol − BC(T)`, bolometric correction `BC` from a small temperature table | Pecaut & Mamajek 2013 | 0 |
| **✅ Peak wavelength / band** | Wien: `λ_max(nm) = 2.898×10⁶ / T(K)` → UV/blue/…/IR label | Wien's law | 0 |
| **✅ Habitable zone, frost line** | `0.95√L .. 1.37√L AU`; `2.7√L AU` — already computed, just expose | Kopparapu 2013 | 0 |
| **Angular size at distance d** | `θ = 2R/d` (e.g. as seen from each planet) | geometry | 0 |
| **Luminosity / radius in SI** | `L·L_SUN` W, `R·696,000 km` — unit conversions | — | 0 |

### 2.2 `DIST` — standalone sampled values

| Property | Distribution | Basis | Draws |
| --- | --- | --- | --- |
| **Metallicity `[Fe/H]`** | skew-normal, mode ≈ 0.0, σ ≈ 0.2 dex, tail to metal-poor (or `COND` on galaxy — see note) | GALAH DR3, APOGEE DR17 | +1 |
| **Age** | `Uniform[0, min(lifetime, 13.8 Gyr)]`; optional mild old-bias | isochrones/SFH; **note the cap (§1)** | +1 |

**Metallicity can be `COND` instead.** We already carry a galactic stellar
**`activity`** ([stars.ts](../../src/generation/stars.ts) `sampleStellarMass`):
old/quiescent populations (elliptical cores) are metal-poorer and α-enhanced,
star-forming arms metal-richer; a radial gradient (~−0.06 dex/kpc) also exists.
Conditioning `[Fe/H]` on `activity`/galactocentric radius is more faithful than a
flat draw and reuses an existing field.

### 2.3 `COND` — relational (needs another field first)

| Property | Relation | Basis | Draws |
| --- | --- | --- | --- |
| **Rotation period** | gyrochronology: `P_rot ≈ f(B−V)·age^0.5` for cool stars (≳ F5); hot stars never spin down (no magnetic braking) → stay fast | Skumanich 1972; Barnes 2007 | needs age |
| **Activity / X-ray** | rotation–activity relation: `L_X/L_bol` saturates ~10⁻³ for young/fast rotators, then decays with age | Wright et al. 2011 | needs age/rotation |
| **Multiplicity (binary?)** | companion fraction rises with mass: M ~25%, G ~45%, A ~50%, O/B ≳70% | Duchêne & Kraus 2013 | +1, `COND` on mass |
| **Giant-planet richness** | occurrence ∝ ~`10^(2·[Fe/H])` — Fe-rich stars host more gas giants | Fischer & Valenti 2005 | `COND` on metallicity |
| **Variability flag** | δ-Scuti / instability-strip membership is a region in the `(T, L)` plane the star may cross | Catelan & Smith 2015 | `COND` on T, L |

### 2.4 `INPUT` — exact formula, future field

| Property | Formula | Needs |
| --- | --- | --- |
| **Evolutionary phase** | fractional age `τ = age/lifetime`; `τ→1` ⇒ leaving the main sequence | age |
| **Final remnant** | white dwarf (`M_init ≲ 8 M☉`), neutron star (~8–20), black hole (≳ 20–25) via the initial-final-mass relation | only if we model death |

---

## 3. Planets

Stored today: `mass, radius, density, equilibriumTemp, inHabitableZone, type,
waterState` ([planets.ts](../../src/generation/planets.ts)). This is where the
user asked to "go crazy" — composition, core/surface temperature, atmosphere,
**oblateness ("circularity")**, etc.

### 3.1 `FORMULA` — free, from existing fields

| Property | Computation (Earth units unless noted) | Basis | Draws |
| --- | --- | --- | --- |
| **✅ Surface gravity** | `g = g⊕·M/R²` (`g⊕ = 9.81 m/s²`) | Newtonian | 0 |
| **✅ Escape velocity** | `v_esc = 11.19 km/s · √(M/R)` | Newtonian | 0 |
| **✅ Insolation flux** | `S = S⊕·L_star/a²` (=1 at Earth; stored at gen, host `L` in scope) | inverse-square | 0 |
| **✅ Central pressure (approx)** | `P_c ∝ M²/R⁴`, anchored to Earth's ~364 GPa (uniform-sphere shape; real cores higher) | hydrostatic | 0 |
| **✅ Composition class** | giants by class; rocky/super-Earth split by `density` → iron-rich (≥6) / rocky / water-ice / volatile | mass–radius statistics | 0 |
| **Hill sphere** | `r_H = a(1−e)·(M_p/3M_star)^{1/3}` — the moon-holding radius | celestial mechanics | 0 |
| **Roche limit** | `d ≈ 2.44·R_p·(ρ_p/ρ_m)^{1/3}` — inside it, moons shear into rings | celestial mechanics | 0 |
| **✅ Earth Similarity Index** | `ESI = Π_i [1 − abs((x_i−x_i⊕)/(x_i+x_i⊕))]^{w_i/n}` over radius, density, `v_esc`, `T_surf` | Schulze-Makuch et al. 2011 | 0 |

### 3.2 `INPUT` — exact formula, needs one new sampled field

| Property | Formula | Needs | Draws |
| --- | --- | --- | --- |
| **Oblateness / "circularity"** | flattening `f = (R_eq−R_pol)/R_eq ≈ (5/4)·(ω²R³/GM)·k`, structure factor `k ≈ 0.6–0.8` (Jupiter f=0.065, Saturn 0.098, Earth 0.0034) | rotation rate `ω` | +1 (ω) |
| **Tidal-lock flag** | locked if `T_lock < age`, `T_lock ∝ a⁶·M_p/(M_*²·R_p³)` | stellar age | 0 (uses age) |
| **Length of day (solar)** | from sidereal rotation + orbital motion; locked ⇒ day = year | rotation, period | 0 |
| **Season strength** | grows with obliquity and eccentricity | tilt, e | 0 |

> **Rotation is the key new field for planets.** Sampling a spin rate unlocks
> oblateness (`f` — literally the requested "how round is it"), day length,
> Coriolis/banding cues, and the magnetic dynamo. If the planet is tidally
> locked, rotation is *not* free — it equals the orbital period.

### 3.3 `DIST` — standalone sampled values

| Property | Distribution | Basis | Draws |
| --- | --- | --- | --- |
| **Rotation period** | broad: giants ~10 h, terrestrials hours→days, retrograde allowed; **but `COND`→ orbital period if tidally locked** | Solar System + theory | +1 |
| **Axial tilt (obliquity)** | ≈ uniform `[0°, 180°]`; ~0° if tidally locked | chaotic-obliquity theory | +1 |
| **Moon count** | Poisson by type: rocky λ≈0.3, super-Earth λ≈0.5, ice/gas giant λ≈3 | Solar System; Teachey & Kipping 2018 | +1 |
| **Ring system?** | rare; `COND` more likely for giants / inside Roche debris | Solar System | +1 |

### 3.4 `COND` — relational

| Property | Relation | Basis | Draws |
| --- | --- | --- | --- |
| **Has atmosphere?** | the **cosmic shoreline**: retained when `v_esc⁴ ≳ k·I_xuv` (escape velocity vs. cumulative XUV insolation) | Zahnle & Catling 2017 | 0 (from `v_esc`, insolation) |
| **Atmosphere type** | by `type` + temperature: giants H/He; ice giants H/He+CH₄ (blue); warm rocky CO₂; cold thin N₂; HZ rocky N₂/CO₂ (O₂ only with life) | Solar System chemistry | 0 |
| **Bond albedo** | by type/cloud/ice (already assumed internally in `albedoFor`) | Solar System | 0 |
| **Surface temperature** | `T_surf = T_eq + ΔT_greenhouse`; ΔT by atmosphere (Earth +33 K, Venus +500 K, airless 0) | radiative balance | 0 (needs atmosphere) |
| **Magnetic field** | dynamo scaling `B ∝ ρ^{1/6}·F^{1/3}` (energy flux) — rough, big scatter | Christensen et al. 2009 | weak `COND` on mass/rotation/age |
| **Plate tectonics?** | favoured by intermediate mass + surface water + youth | speculative | weak `COND` |
| **Appearance / colour** | composition + temperature → palette (ice white-blue, rock brown-grey, water blue, gas banded, lava glow) | phenomenological | 0 — drives [§9](#9-rendering-hooks-drawing-bodies-from-the-data) |

### 3.5 `ARB` — honest random / aesthetic only

- **Core temperature** — scales weakly with mass (more mass → higher central
  pressure → hotter), but the constant depends on composition, accretion heat,
  and radiogenics. Use an arbitrary scaling like `T_core ≈ 5700 K·(M/M⊕)^~0.4`
  and label it illustrative. (Becomes weak `COND` with mass + age.)
- **Absolute surface pressure** — type-conditioned *range* is fine, but the value
  has no formula; sample within bounds and don't oversell it.
- **Surface age / cratering / geology, presence of life** — `ARB`; pick for
  flavour, not fidelity.

---

## 4. Orbits

Stored today: `a, e, argPeriapsis, meanAnomaly0, starMass`
([orbits.ts](../../src/sim/orbits.ts)).

### 4.1 `FORMULA` — free

| Property | Computation | Basis | Draws |
| --- | --- | --- | --- |
| **✅ Periapsis / apoapsis** | `a(1−e)` / `a(1+e)` | geometry | 0 |
| **✅ Mean orbital speed** | `v̄ = (2πa/P)·(1 − e²/4 − …)` | series | 0 |
| **Peri / apo speed (exact)** | vis-viva `v = √(GM(2/r − 1/a))`; `v_peri = (2πa/P)·√((1+e)/(1−e))`, apo inverse | vis-viva | 0 |
| **Specific energy / ang. momentum** | `ε = −GM/2a`; `h = √(GM·a(1−e²))` | two-body | 0 |
| **Mean motion** | `n = 2π/P` | Kepler | 0 |
| **✅ Insolation swing peri↔apo** | flux ratio `((1+e)/(1−e))²` | inverse-square | 0 |
| **Synodic period (pair)** | `1/P_syn = abs(1/P₁ − 1/P₂)` | kinematics | 0 |

### 4.2 `DIST` — already sampled / refinable

- **Eccentricity** — already drawn; the realistic field distribution is roughly
  **Rayleigh**, `σ ≈ 0.05–0.1` (most planets near-circular, a fat tail). Worth
  matching if not already.
- **Inclination (3D)** — small Rayleigh spread; only relevant if the sim leaves
  the current 2D plane.

---

## 5. Black holes

Stored today: `mass, schwarzschildRadius` ([galaxies.ts](../../src/generation/galaxies.ts)).
Almost everything here is a clean `FORMULA` of mass (with one `DIST` for spin).

### 5.1 `FORMULA` — free, from mass (+ spin)

| Property | Computation | Basis | Draws |
| --- | --- | --- | --- |
| **✅ Hawking temperature** | `T_H = 6.17×10⁻⁸ K · (M☉/M)` (absurdly cold for SMBHs) | Hawking 1975 | 0 |
| **✅ Evaporation time** | `t_evap ≈ 2.1×10⁶⁷ yr · (M/M☉)³` | Hawking 1975 | 0 |
| **✅ Photon sphere** | `r_ph = 1.5·r_s` | Schwarzschild GR | 0 |
| **✅ ISCO** | `6GM/c² = 3·r_s` (non-spinning) → `0.5·r_s` (max prograde Kerr) | GR | 0 (needs spin for Kerr) |
| **✅ Shadow size** | apparent diameter ≈ `5.2·r_s` (EHT-style) | GR ray-tracing | 0 |
| **✅ Eddington luminosity** | `L_Edd = 3.3×10⁴ L☉ · (M/M☉)` | radiation/gravity balance | 0 |
| **Sphere of influence** | `r_infl = GM/σ²` (σ from M–σ, [§6](#6-galaxies)) | dynamics | 0 |
| **Stellar tidal-disruption radius** | `R_t ≈ R_*·(M_BH/M_*)^{1/3}` (above ~10⁸ M☉ it lies inside the horizon) | tides | 0 |
| **Class** | mass bins: stellar / intermediate / supermassive | — | 0 |

### 5.2 `DIST` / `COND`

| Property | How | Basis | Draws |
| --- | --- | --- | --- |
| **Spin `a*`** | `DIST` over `[0, 1)`; measured AGN spins skew high | X-ray reflection surveys | +1 |
| **Eddington ratio** | `DIST` (broad lognormal) → sets accretion power | AGN demographics | +1 |
| **Active (AGN/quasar)?** | `COND`: active fraction ~1–10 %, higher in gas-rich/merging hosts | AGN surveys | `COND` on host gas |

---

## 6. Galaxies

Stored today: `type, arms, armStrength, ellipticity, radius, scaleLength,
blackHoleMass, dwarf, name`, plus computed `estimatedStarCount`, diameter,
`activity`, and `cosmicDensity`
([galaxies.ts](../../src/generation/galaxies.ts)). Many derived quantities are
already half-present.

### 6.1 `FORMULA` — free

| Property | Computation | Basis | Draws |
| --- | --- | --- | --- |
| **✅ Velocity dispersion σ** | invert our M–σ: `log(M_BH/M☉) = 8.12 + 4.24·log(σ/200)` | Gültekin et al. 2009 | 0 |
| **Bulge / stellar mass** | `M_BH ≈ 0.14 % · M_bulge` (or `estimatedStarCount·⟨M⟩`) | Häring & Rix 2004 | 0 |
| **Rotation speed (spirals)** | Tully–Fisher `L ∝ v⁴` ⇒ `v_max` from luminosity | Tully & Fisher 1977 | 0 |
| **✅ Environment class** | bin existing `cosmicDensity` → void / wall / filament / node / cluster | — (already computed) | 0 |
| **Redshift / lookback (local)** | `z ≈ H₀·d/c` from distance to origin | Hubble law | 0 |

### 6.2 `COND` — relational (mostly on type / mass)

| Property | Relation | Basis | Draws |
| --- | --- | --- | --- |
| **Colour (red/blue)** | from `type`/`activity` — already via `populationColor` | red-sequence/blue-cloud | 0 |
| **Star-formation rate** | `SFR ∝ M_*^0.7` on the star-forming "main sequence"; ~0 for ellipticals | Noeske et al. 2007 | 0 (uses `activity`) |
| **Gas-phase metallicity** | mass–metallicity relation (rises with `M_*`, flattens ≳10^10.5) | Tremonti et al. 2004 | `COND` on stellar mass |
| **Mean stellar age** | ellipticals/lenticulars old (~10 Gyr); spiral disks younger | — | `COND` on type |
| **Gas fraction / HI mass** | spirals gas-rich, early-types gas-poor | — | `COND` on type |
| **Satellite count** | rises with halo mass | ΛCDM subhalo statistics | `COND` on mass |

### 6.3 `DIST`

- **3D inclination (viewing angle)** — random orientation; sets how squashed the
  disc looks (we currently only store a 2D `orientation`).

---

## 7. Cosmic web / universe scale

We already compute `cosmicDensity` ([galaxies.ts](../../src/generation/galaxies.ts)).
Expose it as inspectable data:

| Property | Computation | Class |
| --- | --- | --- |
| **Local overdensity** | `cosmicDensity` value → void / wall / filament / cluster label | `FORMULA` |
| **Distance / direction from origin** | from camera/world coords (already in the coords HUD) | `FORMULA` |
| **Estimated galaxy count in view** | sum of cell occupancy over the visible rect | `FORMULA` |

### 7.1 Universe age — a single global knob (future)

A per-seed **age of the universe** `T_univ` would be one of the highest-leverage
parameters we could add: a single number that coherently re-themes the whole
hierarchy, because real physics ties many properties to cosmic time.

- **Stellar age ceiling.** Every star caps at `min(lifetime, T_univ)` (§2). A
  young universe has no old stars and few remnants; an old one is remnant-heavy.
- **Chemical enrichment → planets.** Mean `[Fe/H]` rises with cosmic time (metals
  are built up by successive stellar generations), and planet formation needs
  metals — so a young, metal-poor universe is **planet-sparse**, especially in
  giants (Fischer & Valenti 2005).
- **Galaxy evolution.** Mean stellar age, colour, SFR and morphology mix all
  shift with time (young = bluer, clumpier, more star-forming).
- **Structure.** The cosmic web grows hierarchically; older = more clustered.

**Epistemics.** Our universe's age is well measured (13.787 ± 0.020 Gyr, Planck
2018), and because looking far is looking back, redshift surveys *directly*
observe younger universes — the cosmic star-formation history and the
redshift-evolution of the mass–metallicity relation are measured, not guessed.
The caveat: all of it is calibrated to ΛCDM and our physics, so a different *age*
under the same physics is sound; different *constants* are not.

**Design.** Draw `T_univ` once per seed via an **independent** hash (like
`hashSystem`, so it never perturbs a per-body `rng()` stream — it changes
*values*, not draw *counts*, keeping determinism clean), then thread it into the
age cap, a metallicity offset, planet abundance, and galaxy colour/morphology.
Keep it fixed at 13.8 Gyr for the first cuts. This is a **Phase 3** cross-cutting
theme, not a single field.

---

## 8. Moons & future bodies

Moons are "planets orbiting planets" — the entire [§3](#3-planets) catalog
applies, with these specializations:

- **Tidal lock is near-certain** for close major moons (`COND` → almost always
  locked) — so rotation = orbital period, and one face always faces the planet.
- **Tidal heating** — `FORMULA` given orbit: heating `∝ e²·n⁵·R⁵ / …`; an Io-like
  body in an eccentric/resonant orbit runs volcanically hot independent of
  sunlight. Needs eccentricity + a resonance flag.
- **Formed vs. captured** — `DIST`; captured moons take inclined/retrograde,
  often eccentric orbits (drives appearance + naming).

Other future bodies and their "headline" fields:

| Body | Cheap `FORMULA` headline | Notes |
| --- | --- | --- |
| **White dwarf** | `R ∝ M^{−1/3}` (degenerate), Chandrasekhar cap 1.4 M☉; cooling age from temperature | remnant of `M_init ≲ 8 M☉` |
| **Neutron star / pulsar** | `r_s`, spin period, surface gravity ~10¹¹ g⊕, magnetic field 10⁸–10¹⁵ G | `DIST` spin + field |
| **Asteroid / comet belt** | total mass, inner/outer AU, `FORMULA` from frost line & gaps | population, not a body |
| **Rogue / free-floating planet** | full [§3](#3-planets) but no star ⇒ insolation 0, `T_eq` from internal heat only | `COND` thermal |

---

## 9. Rendering hooks (drawing bodies from the data)

The downstream goal is to **draw bodies differently** from these fields. The
highest-value visual couplings, cheapest first:

- **Planet oblateness `f`** → literally squash the rendered disc to `1 − f`
  vertically (the requested "circularity", and a free spin readout).
- **Planet appearance class** (composition + temperature) → colour/texture: ice
  white-blue, rock brown-grey, ocean blue, gas-giant banding, lava glow.
- **Rings** (giants/Roche debris) → an ellipse around the disc at the inclination.
- **Tidal lock** → a fixed day/night terminator instead of a uniform disc.
- **Atmosphere flag** → a soft limb halo; thickness ∝ scale height.
- **Star activity / variability** → corona/glow size, subtle brightness flicker.
- **Black-hole Eddington ratio** → accretion-disc brightness; an AGN jet when active.
- **Galaxy 3D inclination** → squash the existing sprite; bar/arm strength already
  drives morphology.

---

## 10. Priority summary

Ranked by reward-to-effort (free `FORMULA` wins first):

1. **Planet gravity, escape velocity, insolation, composition class, surface
   temperature** — all `FORMULA`, zero draws, immediately inspectable, and
   composition + `T_surf` feed [§9](#9-rendering-hooks-drawing-bodies-from-the-data).
2. **Has-atmosphere (cosmic shoreline)** — `COND` from fields we'll already have;
   a crisp, science-backed yes/no plus a render hook.
3. **Orbit peri/apo + vis-viva speeds** — `FORMULA`, makes eccentric orbits read.
4. **Star surface gravity, density, peak-wavelength band, bolometric mag** —
   `FORMULA`, fleshes out the star panel for free.
5. **Black-hole `FORMULA` pack** (Hawking T, ISCO, photon sphere, Eddington,
   shadow) — all free from mass; turns a 2-row panel into a rich one.
6. **Galaxy σ, stellar mass, environment class, rotation speed** — `FORMULA`
   from fields we already store or compute.
7. **Stellar age (capped!) → tidal-lock + evolutionary phase** — `+1` draw that
   unlocks several `INPUT` properties.
8. **Planet rotation `+1` draw → oblateness, day length, magnetic field** — the
   single most *visual* new field.
9. **Metallicity (`COND` on galaxy activity) → giant-planet richness** — ties
   star, planet, and galaxy layers together.
10. **Moon count / rings / obliquity** — cheap `DIST` flavour; sets up moons.

**Determinism reminder:** every `+1` draw above must be appended at the end of
its body's existing sampling order (stars, then planets, etc.) so the current
seeded universe is preserved for bodies generated earlier in the stream.
