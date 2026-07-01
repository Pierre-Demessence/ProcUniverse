# Physics-driven moon counts (moons Phase 5b refinement)

Replace the per-type moon-count table with a single **physical process** that
derives a planet's moons from its mass and gravity zone (Hill sphere), so the
count *emerges* rather than being rolled against a bucket. Refines the moon-count
side of [moons.md](moons.md) (revisits 5a's `sampleMoonCount` and 5b's spacing);
the moon body-generation feature itself is already committed (`3a612a5`).

## Why change it

Two problems Pierre spotted in the current model:

1. **Inspector count ≠ visible moons.** The panel prints the *sampled*
   `moonCount`, but `generateMoons` drops any moon that would fall outside the
   planet's Hill sphere — so a close-in planet reads "6" while only 2–3 (or 0)
   orbit rings actually exist.
2. **`MOON_MAX = 15` is a phantom.** It is rarely rolled, almost never *placed*
   (the Hill limit truncates it), and is unrealistic for *major* moons anyway —
   real planets top out at ~8 major moons (Jupiter ~8, Saturn ~8, Uranus 5,
   Neptune ~2). The 79/95/146 counts are tiny **irregular** moons = minor moons
   (5e), not majors.

Pierre's insight: the number of moons a planet can hold *is* physics — it scales
with the planet's **mass** (richer circumplanetary disk) and its **gravity zone**
(the Hill sphere, which itself grows with mass and distance from the star). A
formula uses those real numbers; per-type buckets are only a crude proxy for
"mass class".

## The model

One process that both counts and places, so the two can never disagree:

- **Moon zone.** From the **Roche limit** (`≈ 2.5 · R_planet`, where tides would
  shred a moon) out to a fraction of the planet's **Hill radius**
  `R_Hill = a_planet · ∛(M_planet / 3·M_star)`. The Hill radius already folds in
  distance-from-star and star mass, so a close-in planet automatically gets a
  small zone (few moons) with no separate distance term — that is the elegance.
- **Walk outward** in geometric steps (spacing `×1.3–1.7`, real-moon-like — see
  Spacing below).
- **Occupy each slot probabilistically.** At a slot sitting at Hill-fraction
  `f = a / R_Hill`, place a moon with probability

  ```
  p = baseOccupancy(M_planet) · taper(f) · richnessBias(r)
  ```

  - `baseOccupancy(M)` rises smoothly with planet mass (log scale): a small rocky
    world ~0.15, a giant ~0.8. Continuous in mass, so no type buckets.
  - `taper(f)` **diminishes outward** (Pierre's diminishing-returns idea; regular
    moons are likelier close in): highest near the Roche limit, falling toward the
    band's outer edge.
  - `richnessBias(r)` uses a per-planet **moon-richness** trait `r ∈ [0,1]` (see
    Determinism) so two same-mass planets can still differ — formation is
    stochastic (Earth's impact Moon, Neptune's captured Triton are outliers).
- **The count is simply the number of occupied slots** — no target, no cap.

### What it fixes

- **Realistic min / max / average, automatically** and continuous in mass: a
  giant lands ~4–8, a rocky world ~0–2, a hot-Jupiter (tiny Hill sphere) very few.
- **No phantom cap** — the Hill zone and the taper bound the count naturally.
- **Inspector = visible for free** — because the moons *are* the count, the number
  shown equals the rings you see. The "rolled vs placed" gap disappears.

## Determinism — no planet-universe shift

`samplePlanet` already spends exactly one `rng()` draw on the (old)
`sampleMoonCount` at draw position #4 of 5 (mass → rotation → obliquity →
**moons** → rings). We **repurpose that same draw** as `moonRichness = rng()`
(the `r` above): same draw, same position, so the planet stream stays
byte-identical and **every planet is unchanged**. Only the moons — already on
their own independent `hashMoon` seed — move. The displayed `moonCount` becomes
the **emergent** placed count (set from `moons.length`, or counted from the
planet's moon entities — decided at implementation).

## Extends to minor / irregular moons (5e)

The same process covers both populations by radial band and orbit shape:

| Population | Hill band | Occupancy | Orbits | Spawn |
|---|---|---|---|---|
| **Regular** (major, this phase) | Roche → ~0.15 R_Hill | high, mass-driven | prograde, low-e, low-inclination | eager (with the system) |
| **Irregular** (minor, 5e) | ~0.15 → ~0.5 R_Hill | low per slot, but a vast band → many | high-e, high-inclination, often retrograde | lazy, per focused planet |

So 5e becomes "keep walking the same zone into the outer band with different
occupancy/orbit parameters," not a separate mechanism.

## Parameters (tunable; Pierre browser-tunes feel)

- `MOON_ROCHE_RADII = 2.5` — inner edge, in planet radii (existing).
- `MOON_REGULAR_HILL_FRACTION ≈ 0.15` — regular-moon outer edge (was 0.4, which
  reached into irregular territory).
- `MOON_SPACING_MIN / MAX = 1.3 / 1.7` — geometric spacing (was 1.5 / 2.2, too
  wide vs real ~1.4–1.6).
- `baseOccupancy` mass ramp: floor ~0.12 (rocky) → ceiling ~0.85 (giant).
- `taper` curve strength over the band.
- (5e) `MOON_IRREGULAR_HILL_FRACTION ≈ 0.5`, separate low irregular occupancy.

Exact curves are refined during implementation and browser-tuning; the structure
is fixed here.

## Subtasks

- [x] **Occupancy model in `moons.ts`.** Walk Roche → `MOON_REGULAR_HILL_FRACTION
      · R_Hill`; per-slot occupancy `baseOccupancy(mass) · taper(f) ·
      richnessBias(r)`; emergent count. Tightened spacing to `1.3–1.7`.
- [x] **Repurpose the planet draw (determinism-preserving).** `samplePlanet`
      draw #4 → `moonRichness = rng()`; `PlanetPhysical`/`PlanetPhysicalDef`
      swap `moonCount` sampling for `moonRichness`; updated the `pick.test.ts`
      planet literal. Planet stream byte-identical (same single draw at #4).
- [x] **Remove the bucket knobs.** Deleted `MOON_MIN`/`MOON_MEAN`/`MOON_MAX` and
      `sampleMoonCount` from `planets.ts`.
- [x] **Thread richness.** `universe.ts` passes `physical.mass` +
      `physical.moonRichness` into `generateMoons` (Earth→solar conversion moved
      inside for the Hill radius).
- [x] **Inspector = visible.** `countMoons(world, planetId)` counts the planet's
      moon entities; the "Moons" row shows that placed count.
- [x] **Tests.** Emergent counts scale with mass (giant ≫ rocky) and richness,
      a hot close-in world gets 0, a Sun-like giant averages a realistic 2–12;
      determinism (independence: moons consume zero planet-stream draws); orbits
      within the Hill band, named in order.
- [x] Build + tests + lint (189 pass); peer review (LGTM, taper clamped for a
      future minor-moon caller).
- [x] Pierre browser-tune (occupancy ramp, taper, band fractions, spacing) — his
      call per AGENTS.md.

## Decisions / open questions for Pierre

- **Show `moonRichness` anywhere?** Default: no — it is an internal formation
  trait; only the emergent count is shown. (Could surface as a "moon system"
  descriptor later.)
- **Age effect?** Old systems lose moons to tidal decay / escape — a possible
  future refinement, not in v1.
- Band fractions, occupancy ramp, and taper are Pierre's to browser-tune once it
  runs.
