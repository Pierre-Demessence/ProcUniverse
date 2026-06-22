# Celestial Properties — Extension Research

Additional data that could be computed for stars, planets, and orbits beyond what
`StarPhysical` / `PlanetPhysical` / `OrbitElements` currently expose. Every entry
states the observational basis, how it would be computed, and whether a new RNG
draw is required (which would shift the universe seed if inserted mid-stream).

---

## 1. Stars

### Zero-draw additions (pure formula from existing fields)

| Property | Formula | Source |
|---|---|---|
| Surface gravity `g☉` | `M / R²` (solar units) | direct from current `mass`, `radius` |
| Bolometric magnitude | `4.74 − 2.5 · log₁₀(L)` | IAU 2015 nominal |
| Habitable zone (expose) | already in `habitableZone()` but not in `StarPhysical` | Kopparapu 2013 |

### One new RNG draw

| Property | How to sample | Observational basis |
|---|---|---|
| **Metallicity `[Fe/H]`** | Gaussian, μ ≈ −0.1 dex, σ ≈ 0.2 dex | GALAH DR3, APOGEE DR17 — disk field stars |
| **Age** | Uniform over `[0, lifetime]`, or a weak young-bias | Isochrone fitting, gyrochronology; no strong prior → flat is defensible |

**Design note on metallicity:** high-metallicity stars show higher giant-planet
occurrence rates (Fischer & Valenti 2005). If metallicity is added, it can gate
the planet mass distribution (more super-Earths / gas giants around Fe-rich
stars). One draw placed *after* `sampleStellarMass` keeps the existing mass stream
intact.

---

## 2. Planets

### Zero-draw additions (pure formula from existing fields)

| Property | Formula | Notes |
|---|---|---|
| **Surface gravity `g⊕`** | `M / R²` (Earth units) | trivial from current `mass`, `radius` |
| **Escape velocity** | `√(M / R)` (Earth units) | determines whether atmosphere is retained |
| **Insolation flux `S☉`** | `L_star / a²` (Earth insolation = 1 at 1 AU around Sun) | more intuitive than equilibrium temp for habitability comparisons |

**Tidal locking (zero new draw, uses star age):** whether a planet is spin-locked
is a derived Boolean, not sampled. Locking timescale:

```
T_lock ∝ a⁶ · M_planet / (M_star² · R_planet³)
```

If `T_lock < star_age` the planet is tidally locked. Well-constrained; close-in
rocky planets around M dwarfs almost certainly lock. Requires stellar age (see
§1 above).

### One new RNG draw

| Property | How to sample | Observational basis |
|---|---|---|
| **Moon count** | Poisson by type: rocky λ≈0.3, super-Earth λ≈0.5, ice/gas giant λ≈3 | Solar system + Kepler moons statistics (Teachey & Kipping 2018, limited but usable) |

### Speculative (skip for now)

- **Axial tilt** — real distribution for exoplanets is essentially unconstrained
  (only 8 solar-system data points). A uniform `[0°, 90°]` draw is
  scientifically defensible but tells the player nothing meaningful.
- **Surface pressure / atmospheric composition** — needs a full atmospheric
  model; escape velocity + irradiation give qualitative hints but that is not
  the same as a simulated value.
- **Magnetic field** — requires interior structure; no clean formula from mass
  alone.

---

## 3. Orbits

### Zero-draw additions

| Property | Formula |
|---|---|
| **Periapsis** | `a · (1 − e)` |
| **Apoapsis** | `a · (1 + e)` |
| **Mean orbital velocity** | `2π · a / P` where `P = orbitalPeriod(starMass, a)`, result in AU/yr or km/s |

---

## 4. Priority summary

Ranked by reward-to-effort ratio:

1. **Surface gravity + escape velocity** (planets) — zero cost, immediately
   displayable, intuitive.
2. **Insolation flux** (planets) — zero cost, more graspable than equilibrium
   temp for "is this hot/cold?".
3. **Periapsis / apoapsis** (orbits) — zero cost, useful for eccentric orbits.
4. **Stellar age + tidal locking** — one draw (age), then tidal locking is
   deterministic from it. Interesting consequence: tidally-locked label appears
   automatically on the right planets.
5. **Metallicity** — one draw, unlocks planet-formation variation if the planet
   sampler is wired to it.
6. **Moon count** — one draw, decorative for now (moons not yet rendered), but
   sets up a future feature cleanly.
