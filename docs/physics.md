# Physics

How the generated universe obeys real astrophysics: every property of a star,
planet, moon, galaxy or black hole is a pure function of the seed, derived from
real relations. Code lives in `src/generation/` (`stars.ts`, `planets.ts`,
`moons.ts`, `blackbody.ts`, `galaxies.ts`, `units.ts`, `universe.ts`),
`src/sim/orbits.ts` and `src/scale.ts`; tuning choices in `src/config/data.ts`.

## Generation philosophy

One seed gives one mass; everything else is derived from it. Nothing varies at
runtime (a planet's mass never changes), so all properties are one-time pure
functions of the seed, computed when a sector becomes visible and cached. Draws
are consumed from the RNG in a fixed order, so a regenerated sector is
byte-identical on the same JavaScript engine. Engines (and their versions and
CPUs) may differ in the last bit of `Math.sin`, `exp`, `pow` and the like, so
the determinism tests compare numbers rounded to 7 significant digits: a
changed draw or draw order still shows, last-bit noise does not.

Example: a star sampled at 0.5 M☉ is automatically a dim, cool, orange K/M dwarf
with a close-in habitable zone; its planets inherit that dimness.

```text
worldSeed + sector coords ──► per-system RNG (hashSystem → mulberry32)
  │
  ├─ star mass M  ── sampleStellarMass (IMF)
  │     ├─ luminosity L = luminosityFromMass(M)
  │     ├─ radius     R = radiusFromMass(M)
  │     ├─ temperature T = temperatureFromLuminosityRadius(L, R)
  │     ├─ colour       = blackbodyColor(T)
  │     ├─ spectral class = spectralClassFromTemperature(T)
  │     └─ lifetime = lifetimeFromMassLuminosity(M, L)   (age: uniform up to it)
  │
  ├─ frostLine(L), habitableZone(L)
  │
  └─ planets: count + geometric spacing (generateSystem)
        └─ per planet (samplePlanet):
             ├─ a, e, mean anomaly, argument of periapsis (seeded)
             ├─ mass m   (biased by a vs. frost line and star metallicity)
             ├─ type     = classifyType(m, a vs. frost line)
             ├─ radius   = massToRadius(m);  density = ρ⊕·m / R³
             ├─ equilibriumTemp(L, a, albedo);  in habitable zone?
             ├─ orbital period P = sqrt(a³ / M)           (Kepler III)
             └─ moons (generateMoons, independent RNG stream)
```

## Units and constants

Stars are in solar units (M☉, R☉, L☉), planets and moons in Earth units
(M⊕, R⊕), distances in AU within a system and light-years between systems. All
constants live in `units.ts`.

`KM_PER_AU` = 1.495978707 × 10⁸ km and `AU_PER_LY` = 63,241.077 AU; the Sun's
and Stefan–Boltzmann constants are listed under Sources.

A sector is `LY_PER_SECTOR` = 4 ly on a side, so `SECTOR_SIZE` (`scale.ts`) is
about 253,000 AU. The nearest star is typically hundreds of thousands of AU away
while planet orbits are a few to tens of AU: the roughly 10⁵× ratio that makes
space feel real.

## Precision budget

Intuition: a float64 coordinate can only be as fine as its size allows, so a
number that is huge (a galaxy edge) cannot also be precise enough to place a
planet. The camera therefore always works in numbers that are small.

Example: 50,000 ly from the galaxy centre is 3.2 × 10⁹ AU. Float64 has ~15.9
significant digits (relative precision 2.2 × 10⁻¹⁶), so positions there are only
resolved to `3.2e9 × 2.2e-16 ≈ 7 × 10⁻⁷ AU ≈ 105 km`: coarser than a planet's
radius, so a planet far from the origin would visibly jitter.

The renderer uses a floating origin (`renderOriginX/Y/Z`, `REBASE_LY` in
`config/render.ts`; rebasing in `frame/systems/world-systems.ts`): bodies inside a
system are placed relative to their star, and rendering subtracts the origin
before drawing, so the large absolute number is never what reaches the GPU. Zoomed out, the origin re-snaps to a sector boundary once the camera
drifts `REBASE_LY` (8 ly ≈ 5 × 10⁵ AU) away, so rendered magnitudes stay under
that: spacing about 10⁻¹⁰ AU (~17 m). At the system tier the origin is the
focused star, so magnitudes are tens of AU: spacing about a millimetre.

`hashSector` truncates sector indices to int32, bounding the universe to
±2.1 × 10⁹ sectors (about ±8.6 × 10⁹ ly at 4 ly per sector).

## Size versus distance

Intuition: you cannot draw true body sizes and true orbital distances at the
same zoom; the sizes are too small next to the distances.

Example: with Neptune's 30 AU orbit filling a 1000 px viewport (~33 px/AU), Earth
(4.26 × 10⁻⁵ AU radius) is `4.26e-5 × 33 ≈ 0.0014 px`. Making Earth a 2 px dot
needs ~47,000 px/AU, where its 1 AU orbit is 47,000 px wide.

Ratios: Sun radius / Earth orbit = 0.00465 AU / 1 AU ≈ 1/215; Earth radius /
Earth orbit ≈ 1/23,000.

The generated data holds true physical radii: `starVisualRadius`,
`planetVisualRadius` and `blackHoleVisualRadius` (`scale.ts`) convert R☉, R⊕ and
the Schwarzschild radius to AU without exaggeration. Positions and distances are
true. In the default "usable" body scale the renderer applies a pixel floor
(`bodyFloorPx` in `render/body-scale.ts`, a gentle log map of true radius), so
bodies stay visible when zoomed out and true size takes over once it exceeds the
floor; "true" body scale ignores the floor. Star colour, by contrast, is fully
physical.

## Stellar mass: the IMF

Intuition: small stars are far more common than big ones, like pebbles versus
boulders.

Example: of 100 sampled stars, about 76 land in 0.08–0.5 M☉ (mostly M dwarfs) and
only about 2 in 1000 exceed 16 M☉.

`sampleStellarMass` draws from the Kroupa (2001) broken power law
`dN/dM ∝ M^(−α)` by inverse-CDF sampling (one `rng()` draw), clamped to
[`IMF_MIN_MASS`, `IMF_MAX_MASS`] = [0.08, 50] M☉. The segments are continuous at
the break.

| Mass range (M☉) | α |
| --------------- | - |
| 0.08 – 0.5 | 1.3 (`IMF_ALPHA_LOW`) |
| 0.5 – 50 | 2.3 (`IMF_ALPHA_HIGH`) |

An `activity` value in [0, 1] (local star-formation rate from the galaxy field)
warps the uniform draw by `gamma = exp(POP_BIAS · (0.5 − activity) · 2)`: high
activity (spiral arms) shifts toward hot blue stars, low (old cores,
ellipticals) toward cool red ones; 0.5 is the unbiased IMF. `POP_BIAS` is in
`config/data.ts`.

## Mass to luminosity, radius, temperature

Intuition: a heavier star squeezes its core harder and burns far brighter, so
luminosity climbs steeply with mass; temperature then follows from how much light
leaves how large a surface.

Example: a 10 M☉ star is `1.4 × 10^3.5 ≈ 4,400` L☉, and its radius is
`10^0.57 ≈ 3.7` R☉. Then `T = 5772 · 4400^0.25 / 3.7^0.5 ≈ 2.4 × 10⁴ K`, a blue B star.

`luminosityFromMass` (main sequence, solar units):

| Mass (M☉) | L / L☉ |
| --------- | ------ |
| < 0.43 | 0.23 · M^2.3 |
| 0.43 – 2 | M^4 |
| 2 – 55 | 1.4 · M^3.5 |
| ≥ 55 | 32000 · M |

`radiusFromMass`: `R = M^0.8` for `M ≤ 1`, `R = M^0.57` above.

`temperatureFromLuminosityRadius` (Stefan–Boltzmann, `L = 4πR²σT⁴`, constants
cancel in solar units): `T = T☉ · L^(1/4) · R^(−1/2)`, with `T☉` = `T_SUN`.

`lifetimeFromMassLuminosity`: `t = 10 Gyr · M / L` (fuel ∝ mass, burn rate ∝ L).
A star's age is uniform up to the lesser of its lifetime and the universe's age
(`universeAge`, per seed, 8–18 Gyr).

## Reference table

Generated values stay consistent with the observed main sequence
(`spectralClassFromTemperature` bins on temperature; the Sun is G2V at 5772 K):

| Class | T (K) | Mass (M☉) | Radius (R☉) | Luminosity (L☉) | Share of MS stars |
| ----- | ----- | --------- | ----------- | --------------- | ----------------- |
| O | ≥ 33,000 | ≥ 16 | ≥ 6.6 | ≥ 30,000 | 0.00003% |
| B | 10,000–33,000 | 2.1–16 | 1.8–6.6 | 25–30,000 | 0.12% |
| A | 7,300–10,000 | 1.4–2.1 | 1.4–1.8 | 5–25 | 0.61% |
| F | 6,000–7,300 | 1.04–1.4 | 1.15–1.4 | 1.5–5 | 3.0% |
| G | 5,300–6,000 | 0.80–1.04 | 0.96–1.15 | 0.6–1.5 | 7.6% |
| K | 3,900–5,300 | 0.45–0.80 | 0.70–0.96 | 0.08–0.6 | 12% |
| M | 2,300–3,900 | 0.08–0.45 | ≤ 0.70 | ≤ 0.08 | 76% |

## Blackbody colour

Intuition: a hot object glows bluer and a cool one redder; a star's colour is that
of a blackbody at its surface temperature.

Example: the Sun (5772 K) falls just under the 5800 K anchor, a warm white
`#fff1e7`; a 3200 K M dwarf lands between the 3000 and 3500 K anchors, a deep
orange.

`blackbodyColor` linearly interpolates the sRGB anchors below (Mitchell Charity's
`bbr_color` table, 2° observer; Planck spectrum → CIE XYZ → sRGB) and clamps
outside 3000–30,000 K.

| T (K) | sRGB | Look |
| ----- | ---- | ---- |
| 3000 | `#ffb969` | deep orange (M) |
| 3500 | `#ffc989` | orange |
| 4000 | `#ffd5a1` | amber (K) |
| 5000 | `#ffe7cc` | pale gold |
| 5800 | `#fff1e7` | warm white (Sun, G) |
| 6500 | `#fff9fb` | white (F) |
| 7500 | `#eeefff` | white with blue (A) |
| 10000 | `#cfdaff` | blue-white |
| 15000 | `#b7c9ff` | blue (B) |
| 20000 | `#adc1ff` | blue |
| 30000+ | `#a5baff` | blue (O) |

## Kepler orbits

Intuition: a planet's year depends on the star's mass and the planet's distance,
not on the planet's own mass; it moves faster near the star and slower far from it.

Example: at 1 AU a 1 M☉ star gives `P = sqrt(1³/1) = 1` year; the same orbit
around a 4 M☉ star gives `sqrt(1/4) = 0.5` year.

Each orbit (`OrbitElements`, `sim/orbits.ts`) stores `a` (semi-major axis, AU),
`e`, `argPeriapsis` (ω), `meanAnomaly0` (phase at `t = 0`), `inclination` (i),
`longitudeAscendingNode` (Ω) and the host mass `starMass` (M☉). Position is a
closed form of the clock `t`, with no N-body integration, so an un-instantiated
system is exactly where the formula says. `writeOrbitPosition` computes:

1. Period (Kepler III, `orbitalPeriod`, years): `P = sqrt(a³ / M)`; mean motion `n = 2π / P`.
2. Mean anomaly: `M(t) = M0 + n·t`.
3. Eccentric anomaly `E` from `M = E − e·sin E`, by Newton iteration
   (`solveKepler`, at most 8 steps, stop at 1e-12): `E ← E − (E − e·sin E − M) / (1 − e·cos E)`.
4. In-plane position, star at the focus: `x' = a(cos E − e)`, `y' = a·sqrt(1 − e²)·sin E`.
5. Rotate by ω, i and Ω (`perifocalToWorld`) and add the focus; a moon's focus is
   its planet's current position (`updateOrbits`).

Layout (`generateSystem`, constants in `config/data.ts`): 1–8 planets per
star (`PLANET_MIN`/`PLANET_MAX`); the first orbit is at `ORBIT_INNER_AU` · √L
(floored at `ORBIT_INNER_MIN_AU`), each next orbit is the previous × a seeded ratio
(`ORBIT_RATIO_MIN`–`MAX` inside the frost line, wider `ORBIT_RATIO_OUTER_MIN`–`MAX`
beyond), and the walk stops at `DISK_OUTER_AU` · √L (capped at `DISK_OUTER_MAX_AU`).
Eccentricity is `rng()² · ECC_MAX`, so most orbits are nearly circular. Each
planet's plane tilts from a random disk plane by a mutual inclination that scales
with `e`.

## Planet type, radius, density

Intuition: volatiles condense beyond the frost line, so giants form there and small
rocky worlds inside; a world's size follows from its mass, and its density
reveals what it is made of.

Example: a 1 M⊕ planet at 1 AU is rocky with `R = 1^0.279 = 1` R⊕ and the
density of Earth, 5.514 g/cm³; a 300 M⊕ planet beyond the frost line is a gas
giant of about 13.7 R⊕, a little over Jupiter's 11.2 R⊕.

`frostLine(L) = 2.7 · sqrt(L)` AU. `samplePlanetMass` draws a log-uniform mass
(0.05–12 M⊕ inside the frost line, 0.3–3000 M⊕ beyond it), warped toward more
massive planets as stellar metallicity `[Fe/H]` rises. `classifyType`:

| Condition | Type |
| --------- | ---- |
| m ≥ 50 M⊕ | gas giant |
| beyond frost line and m ≥ 8 M⊕ | ice giant |
| m ≥ 2 M⊕ | super-Earth |
| otherwise | rocky |

`massToRadius` is the Chen & Kipping (2017) "Forecaster" broken power law,
anchored so 1 M⊕ is 1 R⊕:

| Regime | Mass (M⊕) | R ∝ |
| ------ | --------- | --- |
| Terran | < 2.04 | M^0.279 |
| Neptunian | 2.04 – 131.6 | M^0.589 |
| Jovian | ≥ 131.6 | M^−0.044 (≈ flat) |

Density is `ρ = ρ⊕ · M / R³` with `ρ⊕` = 5.514 g/cm³: rocky ~3–5.5 g/cm³, giants
~0.7–1.6 g/cm³. Surface gravity is `M / R²` (g⊕), escape velocity
`11.186 · sqrt(M / R)` km/s.

## Equilibrium temperature and habitable zone

Intuition: a planet settles where the starlight it absorbs equals the heat it
radiates, so a brighter star or a closer orbit means a hotter planet; a dim star's
habitable zone hugs it.

Example: Earth (L = 1, a = 1 AU, albedo 0.3) gives `278.3 · 0.7^0.25 ≈ 255 K`.
For an M dwarf with L = 0.01, the habitable zone is only 0.095–0.137 AU.

`equilibriumTemp` (Stefan–Boltzmann balance, `A` = bond albedo, 0.3 for rocky
types and 0.5 for giants):

`T_eq = 278.3 · (1 − A)^(1/4) · (L / a²)^(1/4)` K

(from `((L(1 − A)) / (16σπa²))^(1/4)`). `habitableZone` scales as `√L` with the
conservative Kopparapu (2013) bounds: inner `0.95 · sqrt(L)` AU, outer
`1.37 · sqrt(L)` AU. `inHabitableZone` is `a` inside those bounds. `waterState`
(`surfaceWaterState`) is ice below 273 K, liquid below 373 K, vapour above, on
the greenhouse-corrected surface temperature (`surfaceTemperature`, the
inspector's Surface row), and never liquid without an atmosphere (airless water
is ice below freezing, boiled off above). `T_eq` alone would not do: across the
whole habitable zone it is 218–261 K, so every habitable world (Earth's `T_eq`
is 255 K) would read as ice. With the crude greenhouse the inner ~half of the
zone is wet and its outer part frozen. Tidal locking is
decided by `tidalLockTimescale` (`∝ a⁶·M_p / (M_star²·R_p³)`) against the star's age.

## Moons

Intuition: a planet can only hold moons inside its gravity zone (the Hill sphere,
`a·(M_p / 3M_star)^(1/3)`) and outside the distance where tides tear them apart
(the Roche limit).

`generateMoons` walks outward from `MOON_INNER_RADII` (2.5) planet radii in
geometric steps (`MOON_ORBIT_RATIO_MIN`–`MAX`, 1.3–1.7) to
`MOON_REGULAR_HILL_FRACTION` (0.15) of the Hill radius, rolling at each slot
whether a moon formed (`moonOccupancy`: rises with planet mass, tapers outward,
scaled by the planet's `moonRichness`). Moon count is however many slots fill.
Moon mass is log-uniform (1 × 10⁻⁴ – 0.05 M⊕), radius and density from
`massToRadius`.

## Scales and the central black hole

The same pattern (seed, floating origin, aggregated tiers) repeats at every
level. Galaxies are `GALAXY_RADIUS_LY` = 50,000 ly in radius (a Milky-Way-sized
disk, ~100,000 ly across). The universe tiles into galaxy cells of
`GALAXY_CELL_LY` = 2 × 10⁶ ly, each holding a galaxy with probability
`GALAXY_OCCUPANCY`. So the galaxy-diameter to galaxy-separation ratio is only
about 1:20, far smaller than the ~10⁵ interstellar ratio: the interstellar step
is the emptiest zoom, the intergalactic one is mild by comparison.

Each galaxy hosts a central supermassive black hole whose mass spans
`BLACK_HOLE_MASS_MIN`–`MAX` (10⁶–10¹⁰ M☉), scaled from galaxy size and
morphology (`blackHoleMassFromSize`, in the spirit of the M–σ relation
`log(M_BH/M☉) = 8.12 + 4.24 · log(σ/200 km/s)`; `velocityDispersion` inverts it).
Reference points: Sgr A* ≈ 4.3 × 10⁶ M☉, M87* ≈ 6.5 × 10⁹ M☉.

The Schwarzschild radius is `r_s = 2GM/c²`
(`SCHWARZSCHILD_AU_PER_SOLAR_MASS` = 1.9742 × 10⁻⁸ AU per M☉): about 0.085 AU
for Sgr A* and 128 AU for M87*. At galaxy scale that is invisible, the same
size-versus-distance situation as stars and planets, so the data holds the true
radius.

## Sources

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
