# Realistic Simulation — Physics Reference & Feasibility

Research notes for upgrading ProcUniverse from a *prototype* (arbitrary sizes,
circular orbits, systems on a jittered grid) to a universe whose **data** obeys
real astrophysical relationships, derived deterministically from the seed.

This document answers two questions:

1. **Is the "realistic scale" the user described actually doable?** (Short
   answer: yes for the data and the coordinate system; with one honest caveat
   about rendering.)
2. **Which real-life relationships can we reproduce, which are optional, and
   which are genuinely out of reach?**

It is a reference for the design and plan in
[../plans/realistic-simulation.md](../plans/realistic-simulation.md). Every
quantitative claim cites a source (see [§9](#9-sources)).

---

## 1. Current prototype vs. reality (the gap)

From [src/generation/universe.ts](../../src/generation/universe.ts) and
[src/sim/orbits.ts](../../src/sim/orbits.ts):

| Aspect | Prototype today | Reality |
| ------ | --------------- | ------- |
| Star spacing vs. planet orbit | `SECTOR_SIZE=5000`, 4×4 grid → stars ~1250 apart; planet orbits ~30–340 from star → ratio **≈ 7×** | Earth–Sun = 1 AU; Sun–Proxima ≈ 4.24 ly ≈ **268,000 AU** → ratio **≈ 268,000×** |
| Star radius vs. orbit | star radius 28–50 ≈ planet gaps 35–62 (star as big as the system) | Sun radius = 0.00465 AU; Earth orbit = 1 AU → star is **~0.5%** of the inner orbit |
| Orbit speed | `omega = ORBIT_K / a^1.5`, `ORBIT_K` a **global constant** | `omega = sqrt(G·M_star / a³)` — depends on the **star's mass** |
| Orbit shape | perfect circles | ellipses (Kepler), eccentricity `e ∈ [0, ~0.9]`, most planets `e < 0.1` |
| Star colour | random pick from a 9-colour palette | a **function of temperature** (blackbody), itself a function of mass |
| Star/planet properties | none (just radius + colour) | mass, luminosity, temperature, spectral type, density, equilibrium temperature, … |
| System placement | regular 4×4 sub-grid + jitter | Poisson / clustered; density varies by galactic location |

The prototype is internally consistent and performant; it is simply *not* scaled
or parameterised by physics. Everything below is about replacing the arbitrary
constants and the random palette with **derivations from one seeded mass per
star**.

---

## 2. The scale question — is it possible?

**Verdict: yes, but only because the project already uses a floating origin.**
Naive single-precision world coordinates would *not* work; the existing
camera-relative rebasing
([src/main.ts](../../src/main.ts) `renderOriginX/Y`, `REBASE_DIST`) is exactly
what makes real scale tractable.

### 2.1 The numbers

Reference constants:

- 1 AU ≈ 1.496 × 10⁸ km
- 1 light-year ≈ 9.461 × 10¹² km ≈ **63,241 AU**
- 1 parsec ≈ 206,265 AU ≈ 3.26 ly
- Sun radius ≈ 696,000 km ≈ 0.00465 AU
- Earth radius ≈ 6,371 km ≈ 4.26 × 10⁻⁵ AU
- Neptune orbit ≈ 30 AU; nearest star (Proxima) ≈ 4.24 ly ≈ 268,000 AU

So the user's framing is correct: if **1 AU = 1 px** at the deepest zoom, the
nearest star sits at **~268,000 px** (their "~266,000" is essentially exact).
A more typical stellar separation in the solar neighbourhood is ~5 ly
(stellar density ~0.12 stars/pc³), i.e. **~316,000 AU** — the interstellar gap
is a *quarter-million to a third of a million* times the Earth–Sun distance.

The full dynamic range we care about, from the smallest interesting feature
(a planet/moon radius, ~10³–10⁵ km) to a galaxy span (~10⁵ ly), is roughly
**10¹⁴ – 10¹⁵**.

### 2.2 The precision budget (why floating origin is mandatory)

JavaScript numbers are IEEE-754 `float64`: 52-bit mantissa → ~15.9 significant
digits, relative precision ≈ 2.2 × 10⁻¹⁶.

- **Naïve absolute coordinates (in AU).** Near a galaxy edge (~50,000 ly ≈
  3.2 × 10⁹ AU), the representable spacing is `3.2e9 × 2.2e-16 ≈ 7 × 10⁻⁷ AU
  ≈ 105 km`. That is coarser than a planet's radius → **visible jitter** when
  zoomed onto a planet far from the origin. Naïve coordinates fail.
- **With floating origin (already implemented).** We never form that huge
  absolute number at render time. A star's position is stored as
  `(integer sector index) + (small float offset within the sector)`; rendering
  computes `(sector − cameraSector) × sectorSize + offset` where
  `(sector − cameraSector)` is a *small* integer (you are within a few sectors
  of the camera). The rendered magnitude stays ≤ a few sector widths
  (~10 ly ≈ 6 × 10⁵ AU), giving spacing `6e5 × 2.2e-16 ≈ 1.4 × 10⁻¹⁰ AU ≈
  2 cm`. **Effectively exact.**
- **Rebasing to the nearest star at the system tier** (a small extension of the
  current sector-rebasing) drops rendered magnitudes to ≤ tens of AU → spacing
  ~nanometres. Far more than enough for planet/moon detail.

**Conclusion:** keep two coordinate scales — integer **sector indices** for
interstellar distances, and a local **AU frame** within a system — and always
render camera-relative. The current code is ~80% of the way there; the realism
work mainly changes the *scale constants* and adds a star-local frame for the
deepest tier.

> Note: `hashSector` truncates coordinates with `sx | 0` (int32), bounding the
> universe to ±2.1 × 10⁹ sectors. At ~5 ly per sector that is ±10¹⁰ ly — larger
> than the observable universe, so "effectively infinite" still holds. If
> sectors shrink, widen the hash to 53-bit-safe integers.

### 2.3 The size-vs-distance caveat (the one real limit)

Even with perfect coordinates, you **cannot render true body sizes and true
orbital distances at the same zoom** — and neither can NASA. The ratio of an
orbital distance to a body radius is enormous:

- Sun radius / Earth orbit = 0.00465 AU / 1 AU ≈ **1 / 215**
- Earth radius / Earth orbit = 4.26 × 10⁻⁵ AU / 1 AU ≈ **1 / 23,000**

At a zoom where Neptune's 30 AU orbit fits a 1000 px viewport (~33 px/AU), Earth
is `4.26e-5 × 33 ≈ 0.0014 px` — invisible. To make Earth a 2 px dot you need
~47,000 px/AU, at which a 1 AU orbit is 47,000 px wide — you see a tiny arc, not
the system. This is why every "solar system to scale" diagram is a lie.

**Resolution (and it is a clean one):** treat **physical size as data** and use
a separate, deliberately *non-physical* **visual radius** for rendering (e.g.
`r_vis = clamp(base + k · log(R_phys / R_ref), min, max)`). Positions/distances
stay true; only the drawn disc size is exaggerated so bodies are visible. The
user already accepted "data first, visuals later", so the realism work is a
**data layer**; the renderer keeps exaggerated discs until a later visual pass
chooses the mapping. Star **colour**, by contrast, *can* be fully physical and
looks great (see [§4.4](#44-colour-from-temperature-blackbody)).

### 2.4 The emptiness trade-off (a UX cost, not a feasibility one)

Real scale makes space *real* — i.e. mostly empty. Going from "I can see this
system's planets" to "the next star is a dot" is a zoom-out of ~10⁴–10⁵×. Honest
options, in increasing deviation from realism:

1. **Lean on LOD aggregates (already built).** As you zoom out, stars merge into
   the density-glow tiers, so you are never staring at literal void — the field
   fills with aggregate structure. Realism and usability coexist *because of*
   the LOD pyramid.
2. **Accelerating / exponential zoom** with momentum so the 10⁵× traversal is a
   second of scrolling, not a hundred wheel-notches.
3. **Optional "scale compression" knob** — a monotonic non-linear remap that
   shrinks interstellar gaps for playability while preserving ordering and
   *approximate* ratios. Sacrifices strict realism; expose as a toggle so the
   purist default stays true-scale.
4. **Navigation aids later** — "jump to nearest star", bookmarks, a warp.

Recommendation: **default to true scale**, ship the LOD-fill + fast-zoom, and
keep the compression knob as an off-by-default option.

---

## 3. The generation philosophy: one seed → one mass → everything

Nothing changes at runtime (a planet's mass never varies), so **all properties
are one-time pure functions of the seed**, computed when a cell becomes visible
and cached — exactly the model already used for `generateSectorData`. The whole
chain hangs off a single sampled number per star, its **mass**:

```text
worldSeed + sectorCoords ──► per-system RNG (mulberry32)
  │
  ├─ star mass  M  ── sampled from the Initial Mass Function (IMF)
  │     ├─ luminosity  L = f(M)            (mass–luminosity relation)
  │     ├─ radius      R = f(M)            (mass–radius relation)
  │     ├─ temperature T = f(L, R)         (Stefan–Boltzmann)
  │     ├─ colour          = blackbody(T)  (Planck → sRGB)
  │     ├─ spectral class   = bin(T)       (O B A F G K M)
  │     └─ main-sequence lifetime = f(M, L)
  │
  ├─ habitable zone, frost line  = f(L)    (derived radii in AU)
  │
  └─ planets: count + geometric spacing (seeded)
        └─ per planet:
             ├─ semi-major axis a, eccentricity e, phase M0, arg. periapsis ϖ
             ├─ mass  m   (sampled; biased by a vs. frost line)
             ├─ type      = bin(m, a vs. frost line)   rocky / ice / gas
             ├─ radius    = massRadius(m, type)
             ├─ density   = m / volume
             ├─ equilibrium temperature  T_eq = f(L, a, albedo)
             ├─ "in habitable zone?" flag
             ├─ orbital period  P = 2π·sqrt(a³ / (G·M))   (Kepler III)
             └─ moons (recurse with the same Kepler math)
```

Determinism is preserved by drawing rolls in a fixed order (as the current code
already does) so a regenerated cell is byte-identical.

---

## 4. Stars (the high-value core)

### 4.1 Mass from the Initial Mass Function

Stellar masses are **not** uniform — low-mass stars dominate. Sample `M` from the
**Kroupa (2001) broken power law**, `dN/dM ∝ M^(−α)`:

| Mass range (M☉) | α |
| --------------- | - |
| 0.08 – 0.5 | 1.3 |
| 0.5 – ~150 | 2.3 |

(The classic Salpeter 1955 slope is α = 2.35 above 0.5 M☉; below 0.08 M☉ are
brown dwarfs, α ≈ 0.3.) Practically: clamp to ~[0.08, 50] M☉ and inverse-CDF
sample. The result is a field that is **~76% M dwarfs**, matching reality
([§4.3](#43-the-reference-table)). Brown dwarfs (< 0.08 M☉) can be included as a
dim sub-stellar class or excluded for v1.

### 4.2 Mass → luminosity, radius, temperature

**Mass–luminosity** (piecewise, main sequence):

$$
\frac{L}{L_\odot} \approx
\begin{cases}
0.23\,(M/M_\odot)^{2.3} & M < 0.43\,M_\odot \\
(M/M_\odot)^{4} & 0.43 \le M < 2\,M_\odot \\
1.4\,(M/M_\odot)^{3.5} & 2 \le M < 55\,M_\odot \\
32000\,(M/M_\odot) & M \ge 55\,M_\odot
\end{cases}
$$

**Mass–radius** (main sequence, approximate):

$$
\frac{R}{R_\odot} \approx
\begin{cases}
(M/M_\odot)^{0.8} & M \lesssim 1\,M_\odot \\
(M/M_\odot)^{0.57} & M \gtrsim 1\,M_\odot
\end{cases}
$$

**Temperature** from Stefan–Boltzmann, `L = 4πR²σT⁴`:

$$
T = T_\odot \left(\frac{L}{L_\odot}\right)^{1/4}\left(\frac{R_\odot}{R}\right)^{1/2},
\qquad T_\odot = 5772\ \text{K}
$$

This chain is cheap, well-established, and reproduces the main sequence. (Tuning
the radius exponents to the reference table below is fine — they are approximate
in the literature anyway.)

### 4.3 The reference table

Anchor/clamp generated values against the observed main sequence
(Wikipedia, *Stellar classification*; fractions from Ledrew 2001):

| Class | T (K) | Mass (M☉) | Radius (R☉) | Luminosity (L☉) | Share of MS stars |
| ----- | ----- | --------- | ----------- | --------------- | ----------------- |
| O | ≥ 33,000 | ≥ 16 | ≥ 6.6 | ≥ 30,000 | 0.00003% |
| B | 10,000–33,000 | 2.1–16 | 1.8–6.6 | 25–30,000 | 0.12% |
| A | 7,300–10,000 | 1.4–2.1 | 1.4–1.8 | 5–25 | 0.61% |
| F | 6,000–7,300 | 1.04–1.4 | 1.15–1.4 | 1.5–5 | 3.0% |
| G | 5,300–6,000 | 0.80–1.04 | 0.96–1.15 | 0.6–1.5 | 7.6% |
| K | 3,900–5,300 | 0.45–0.80 | 0.70–0.96 | 0.08–0.6 | 12% |
| M | 2,300–3,900 | 0.08–0.45 | ≤ 0.70 | ≤ 0.08 | 76% |

Spectral class is just a **bin of temperature**. The Sun is G2V at 5772 K.

### 4.4 Colour from temperature (blackbody)

A star's colour is the colour of a blackbody at its temperature — a *real*,
physical mapping (Planck spectrum → CIE XYZ → sRGB). Use Mitchell Charity's
tabulated `bbr_color` dataset (sRGB, 2° observer) as a lookup with interpolation.
Anchor points:

| T (K) | sRGB | Look |
| ----- | ---- | ---- |
| 3000 | `#ffb969` | deep orange (M) |
| 3500 | `#ffc989` | orange |
| 4000 | `#ffd5a1` | amber (K) |
| 5000 | `#ffe7cc` | pale gold |
| 5800 | `#fff1e7` | warm white (Sun, G) |
| 6500 | `#fff9fb` | white (F) |
| 7500 | `#eeefff` | white w/ blue (A) |
| 10000 | `#cfdaff` | blue-white |
| 15000 | `#b7c9ff` | blue (B) |
| 20000 | `#adc1ff` | blue |
| 30000+ | `#a5baff` | blue (O) |

This single change — colour from `T(M)` instead of a random palette — is the
biggest *visual* realism win for the least code.

### 4.5 Lifetime, ages, remnants (optional)

Main-sequence lifetime `t ∝ M/L ≈ 10 Gyr × (M/M☉)^(−2.5)`. Massive stars die in
millions of years; M dwarfs outlive the universe. If we later sample a stellar
**age** and compare to lifetime, we can spawn evolved states — red giants, white
dwarfs, neutron stars — for a small, deterministic fraction. Not required for v1
(treat all stars as main sequence), but a natural extension.

---

## 5. Planets

### 5.1 Orbital architecture

- **Count:** sample 0–~10 with a distribution; bias by stellar mass/metallicity
  later.
- **Spacing:** real systems are roughly geometric (Titius–Bode-like): each orbit
  ~1.4–2.0× the previous. Seed the ratio per gap. Optionally enforce **Hill
  stability** (neighbours separated by several mutual Hill radii) to avoid
  obviously unstable packings.
- **Inner/outer bounds:** scale with the star — inner edge near a few stellar
  radii / sublimation distance, outer edge tens to hundreds of AU.

### 5.2 Kepler ellipses (replaces circular orbits)

Per planet store `a` (semi-major axis), `e` (eccentricity), `ϖ` (argument of
periapsis), `M0` (mean anomaly at epoch). Position at time `t` is analytic:

1. Period (Kepler III, in solar units, `a` in AU, `M` in M☉, `P` in years):
   $$P = \sqrt{a^3 / M_\star}, \qquad n = 2\pi / P \ \text{(mean motion)}$$
2. Mean anomaly: `M(t) = M0 + n·t`.
3. Solve Kepler's equation `M = E − e·sin E` for eccentric anomaly `E` by Newton
   iteration (3–5 steps): `E ← E − (E − e·sin E − M)/(1 − e·cos E)`.
4. True anomaly and radius:
   $$\nu = 2\,\operatorname{atan2}\!\big(\sqrt{1+e}\,\sin\tfrac{E}{2},\ \sqrt{1-e}\,\cos\tfrac{E}{2}\big), \quad r = a(1 - e\cos E)$$
5. Position relative to the star (the focus):
   $$x = r\cos(\nu + \varpi), \quad y = r\sin(\nu + \varpi)$$

Still O(few) per planet per frame, still a pure function of `t` — so an
un-instantiated system's planets remain exactly where the formula says. The key
physics fixes vs. today: the period depends on **M_star and a** (not a global
constant), and motion obeys Kepler's 2nd law (faster at periapsis).

> The user's intuition "orbit speed depends on size + distance" is almost right —
> it depends on the **star's mass** and the **semi-major axis**, and effectively
> *not* on the planet's own mass (for `m ≪ M`).

### 5.3 Mass, type, radius, density

- **Mass:** sample per planet; bias heavier/gas-rich beyond the frost line.
- **Type** by mass and orbit vs. the **frost line** `a_frost ≈ 2.7·sqrt(L/L☉)`
  AU (volatiles condense beyond it → giants tend to form there; rocky inside):
  rocky / super-Earth / ice giant / gas giant.
- **Mass–radius** (Chen & Kipping 2017 "Forecaster", broken power law):

  | Regime | Mass | `R ∝ M^…` |
  | ------ | ---- | --------- |
  | Terran (rocky) | ≲ 2 M⊕ | M^0.28 |
  | Neptunian | 2 – ~130 M⊕ | M^0.59 |
  | Jovian | ~130 M⊕ – 0.08 M☉ | M^(−0.04) (≈ flat: more mass ≠ bigger) |

  For Earth-like rocky bodies, Zeng et al. 2016 gives `R/R⊕ ≈ (M/M⊕)^0.27`.
- **Density:** `ρ = m / (4/3 π R³)` → rocky ~3–5.5 g/cm³, giants ~0.7–1.6 g/cm³,
  a free consistency check that also feeds gravity.

### 5.4 Equilibrium temperature & habitable zone

A planet's temperature follows from stellar luminosity, distance, and albedo
(Stefan–Boltzmann balance):

$$
T_{eq} = \left(\frac{L\,(1-A)}{16\,\sigma\,\pi\,a^2}\right)^{1/4}
\;=\; 278.3 \,(1-A)^{1/4}\,\left(\frac{L/L_\odot}{(a/\text{AU})^2}\right)^{1/4}\ \text{K}
$$

Equivalently `T_eq = T_star·sqrt(R_star/2a)·(1−A)^{1/4}`. This is exactly the
"where a planet sits relative to its star changes its properties" relationship
the user asked for.

The **habitable zone** (liquid-water orbits) scales as `sqrt(L)`:

$$
r_{edge} = \sqrt{\frac{L/L_\odot}{S_{edge}}}\ \text{AU}
$$

Using the Sun as anchor (Kopparapu 2013, conservative): inner ≈ `0.95·sqrt(L)`
AU, outer ≈ `1.37·sqrt(L)` AU (optimistic ~0.84–1.67). So a luminous F/A star has
a far-out HZ; an M dwarf's HZ is so close in that planets there are tidally
locked. Derived planet flags ("in HZ", "tidally locked candidate", "water:
ice/liquid/vapour") fall straight out of `T_eq` and the HZ bounds.

### 5.5 Further derived properties (cheap, optional)

Surface gravity `g = GM/R²`, escape velocity, whether an atmosphere is retained
(escape velocity vs. `T_eq` → light-gas retention), axial tilt, rotation period,
ring/moon presence. All one-time seed functions; add as desired.

---

## 6. Universe scale — galaxies, black holes, and the cosmic hierarchy

The same `f(seed, coords)` + floating-origin + LOD-aggregation pattern repeats at
every level, so simulating a **universe** (many galaxies) rather than a single
star field is *additive*, not a rewrite: it adds levels **above** the star field,
each one a generated, streamed, aggregated layer just like the ones that exist.

### 6.1 The extended LOD pyramid

| Tier | On screen | Drawn as |
| ---- | --------- | -------- |
| Universe | the cosmic web | cluster / filament density glow |
| Galaxy field | many galaxies | each galaxy = one glow / sprite |
| Galaxy | one galaxy | density field (spiral / elliptical) + central black hole |
| Star field | many stars in a galaxy | star dots |
| System | one star | star + planets + moons (animated) |

The existing `system / star / galaxy` tiers become the **bottom three**; two new
aggregate tiers (galaxy-field, universe) sit on top. Addressing becomes
hierarchical: a body is `(galaxy index) → (sector index in galaxy) → (offset)`,
each level seeded from the level above (`hashGalaxy(worldSeed, gx, gy)` →
`hashSector(galaxySeed, sx, sy)` → per-system RNG). Floating origin rebases at
whichever level the camera occupies.

### 6.2 The scales (and why the universe tier is *less* empty)

- Galaxy diameter (Milky Way stellar disk): ~100,000 ly.
- Intergalactic separation: ~millions of ly (Andromeda ≈ 2.5 Mly; field galaxies
  a few Mly apart).
- Observable universe: ~93 billion ly.

Crucially, the **ratio** galaxy-diameter : galaxy-separation is only ~1:30 —
*far* smaller than the interstellar ratio (~1:10⁵, §2.1). So once you are zoomed
out far enough to see a galaxy as a dot, its neighbours are comparatively close.
**The interstellar step stays the emptiest zoom**; the intergalactic step is mild
by comparison. Galaxies also cluster (the cosmic web: filaments + voids), which we
can approximate with clustered placement; a uniform field is a fine v1.

### 6.3 Central black holes

Most large galaxies host a **central supermassive black hole** (SMBH). Its mass
correlates with the host via the **M–σ relation** (`M_BH ∝ σ⁴`; roughly ~0.1% of
bulge mass), so it derives deterministically from the generated galaxy:

- Sgr A* (Milky Way) ≈ 4.3 × 10⁶ M☉.
- M87* ≈ 6.5 × 10⁹ M☉.

The event horizon is tiny — Schwarzschild radius `r_s = 2GM/c²` is ~0.08 AU for
Sgr A*, ~120 AU for M87* — i.e. *invisible* at galaxy scale, the same
size-vs-distance situation as stars and planets (§2.3): store the true mass/radius
as data, render a stylised marker. Dwarf galaxies may host an intermediate-mass
black hole or none; "every major galaxy has one central black hole" is a fine
simplification. Stellar-mass black holes (from evolved massive stars) are a
separate, later remnant type (§7).

### 6.4 Galaxy shape drives star placement

A galaxy is more than a bounding box: its **type** (spiral / elliptical /
irregular / lenticular / dwarf) defines a **density field** — a logarithmic-spiral
arm pattern, or a smooth Sérsic / de Vaucouleurs falloff. Star generation is then
*conditioned* on position within that field (denser in arms / the core), which is
what turns the flat sector grid into a real galaxy and makes the zoomed-out
aggregate genuinely meaningful. This promotes "galactic structure" from an
optional nicety to the core of the galaxy tier.

### 6.5 Recommendation

**Design the coordinate, seeding, and LOD systems to be N-level from the start,
but implement one galaxy first.** The hard parts — floating origin, LOD streaming,
function-of-coords determinism — are identical at every level, so a
hierarchy-ready design lets the universe layer (galaxies + SMBHs + cosmic tiers)
drop in additively later without reworking systems / planets. Build the galaxy you
can fly around and inspect; wrap galaxies into a universe as the next milestone.

---

## 7. Beyond v1 (optional realism, later phases)

| Feature | Notes |
| ------- | ----- |
| Stellar ages & evolution | Giants, white dwarfs, neutron stars from age vs. lifetime |
| Binary / multiple systems | ~50% of stars are multiples; S-/P-type orbits, more complex but approximable |
| Galactic structure | Stellar **density** varies (spiral arms, disk vs. halo, bulge); metallicity gradient changes planet occurrence — ties directly into the LOD aggregate tiers |
| Clusters & nebulae | Correlated star positions (vs. grid), star-forming regions |
| Belts, comets, rings | Asteroid/Kuiper analogues; ring systems |
| Moons | Hierarchical Kepler orbits around planets |

Galactic-scale density is the most interesting because it makes the **zoomed-out
aggregate tiers physically meaningful** instead of uniform noise.

---

## 8. What's realistic, what's optional, what's out of reach

**Realistic and recommended now (data layer):**

- IMF-sampled stellar mass → L, R, T, spectral class, blackbody colour.
- Kepler **elliptical** orbits with correct periods (depend on `M_star`, `a`).
- Real AU/ly **scale ratios** in the coordinate system (via floating origin).
- Planet equilibrium temperature, habitable zone, frost line, type-by-mass,
  mass–radius, density, and the derived habitability flags.
- Titius–Bode-ish spacing; optional Hill-stability check.

**Doable but optional (later phases):** stellar ages/evolution, binaries,
galactic density structure, clusters/nebulae, belts, moons, atmospheres.

**Hard / not worth it / impossible:**

- **True N-body gravitation** — the plan already (correctly) avoids it: it is
  chaotic, expensive, and incompatible with regenerate-on-demand determinism.
  Analytic Kepler is the right call.
- **Full planet-surface realism** — explicitly out of scope (deepest zoom = the
  system).
- **Rendering true sizes *and* true distances at one zoom** — physically
  impossible; decouple a visual radius from the physical one (see
  [§2.3](#23-the-size-vs-distance-caveat-the-one-real-limit)).
- Relativistic effects, detailed spectral-line modelling — overkill for a 2D
  exploration sandbox.

---

## 9. Sources

- Stellar classification, temperature/mass/radius/luminosity per class,
  population fractions — Wikipedia, *Stellar classification* (after Habets &
  Heinze 1981; Ledrew 2001, *The Real Starry Sky*).
- Mass–luminosity piecewise relation — Wikipedia, *Mass–luminosity relation*
  (Salaris & Cassisi 2005; Duric 2004).
- Initial mass function (Kroupa broken power law; Salpeter slope) — Wikipedia,
  *Initial mass function* (Kroupa 2001; Salpeter 1955).
- Blackbody → sRGB colour table — Mitchell Charity, *What color are the stars?*
  / `bbr_color.txt`, vendian.org (sRGB, 2001).
- Planetary equilibrium temperature (`T_eq`, the 278.3 K constant) — Wikipedia,
  *Planetary equilibrium temperature* (Catling & Kasting 2017).
- Habitable zone scaling and bounds — Wikipedia, *Habitable zone* (Kasting et
  al. 1993; Kopparapu et al. 2013).
- Planet mass–radius — Chen & Kipping 2017 ("Forecaster"); Zeng et al. 2016
  (rocky `M^0.27`).
- Kepler's laws / orbit solution — standard celestial mechanics.
- Supermassive black holes (Sgr A*, M87*) and the M–σ relation — Wikipedia,
  *Supermassive black hole* / *M–sigma relation* (Gültekin et al. 2009; Event
  Horizon Telescope 2019).
- Galaxy sizes and separations, cosmic web — Wikipedia, *Milky Way*, *Andromeda
  Galaxy*, *Observable universe*.

Constants: `σ = 5.670 × 10⁻⁸ W m⁻² K⁻⁴`, `T_⊙ = 5772 K`, `L_⊙ = 3.828 × 10²⁶ W`,
`1 AU = 1.496 × 10⁸ km`, `1 ly = 63,241 AU`.
