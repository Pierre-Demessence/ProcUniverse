# Moons (Phase 5 of system-scale-realism)

Generate moons around planets, render them (distinct when you zoom to a planet),
and expose them in the inspector and location tree. Phase 5 of
[system-scale-realism](system-scale-realism.md) — it builds directly on the
Phase-4 body-scale morph (a moon is just a body with the smallest floor tier).

## Why now

The morph makes bodies visible at any zoom, so moons finally *can* be shown. On
the full-system view a moon merges with its planet's marker (the Moon is 0.0026 AU
from Earth ≈ sub-pixel at a system framing) — that is expected and correct; moons
become distinct when you zoom into a planet (the "planet view", same morph one
level deeper).

## 1. Moon-count realism (Pierre's ask — review first)

The current `sampleMoonCount` (in `planets.ts`) is
`min(floor(-mean · ln(1-u)), 20)` with `mean` = 3 (giants) / 0.5 (super-earth) /
0.3 (rocky). Because of the `floor`, the **actual** mean is far below the `mean`
parameter, and giants can roll zero moons:

| Type | `mean` | Actual mean | P(0 moons) | Real (major moons) |
|---|---|---|---|---|
| Rocky | 0.3 | ~0.04 | 96% | ~0.75 (Earth 1, Mars 2, Mercury/Venus 0) |
| Super-earth | 0.5 | ~0.16 | 86% | speculative |
| Ice/gas giant | 3 | ~2.5 | **28%** | 5–8 (Jupiter/Saturn ~8, Uranus 5, Neptune ~2) |

Problems: it under-counts everywhere, and **~28% of giants get zero moons** —
every real giant has several. (Real *total* counts are dominated by tiny captured
irregulars — Jupiter 95, Saturn 146 — which we should NOT render; we model the
handful of **major** moons worth seeing/inspecting.)

**Proposed model** — a per-type minimum plus a geometric tail with a *true* target
mean, capped at the major-moon range:

| Type | Min | Target mean | Cap |
|---|---|---|---|
| Rocky | 0 | ~0.5 | — |
| Super-earth | 0 | ~1 | — |
| Ice giant | 1 | ~4 | — |
| Gas giant | 2 | ~6 | ~12–15 |

So giants always have ≥1–2 major moons (never zero), rocky worlds are usually
moonless with the occasional 1–2, and the cap keeps counts renderable. Exact
knobs go in `config/data.ts`. *This re-rolls the universe* (moon count is a
sampled field) — expected, and Pierre's call on the numbers.

## 2. Moon body generation (data)

For each planet, generate `moonCount` moons with:

- **Orbit (around the planet):** semi-major axis as a multiple of the planet's
  radius, geometric-spaced from just outside the Roche limit (~2–3 R_planet) out
  toward the planet's **Hill radius** `a_planet · (M_planet / 3 M_star)^{1/3}`
  (moons must stay well inside it for stability — cap at ~0.4 R_Hill). Earth's
  Moon at ~60 R⊕ = 0.0026 AU falls straight out of this. Eccentricity low.
- **Physical props:** small mass (log-uniform, ~10⁻⁴–0.05 M⊕; the Moon is
  0.012, Titan 0.023), radius from an icy/rocky mass–radius relation, density,
  equilibrium temperature (from the *star*, at the planet's orbit), tidal-lock
  (moons are almost always locked → show synchronous rotation).
- **Names:** planet name + Roman numeral (e.g. `G-4F2A9 b I`), the standard moon
  convention.
- **Determinism:** generate moon orbits/props from an **independent hash**
  (`hashMoon(systemSeed, planetIndex)`), NOT the planet rng stream, so adding
  moons doesn't shift the star/planet layout. (The count stays in `samplePlanet`;
  only revising the count model shifts planets.)

## 3. Rendering

- Spawn moon entities (like planets) with `PositionDef` + `RenderableDef` +
  an `OrbitElementsDef` centred on the **planet** (which itself orbits the star).
  The morph draws them at the smallest floor tier — visible markers when zoomed
  to the planet, true scale when you zoom onto a moon.
- Moon **orbit rings** around the planet (reuse `drawOrbitRings`, centred on the
  moon's planet).
- A body's moons only matter at planet-zoom; at system-zoom they sit on the
  planet marker (fine). Consider a "frame this planet" action (double-click /
  inspector button) that zooms to frame the planet + its moon orbits.

## 4. Inspector, picking, nav tree

- Moon panel: mass, radius, density, orbit (a, period), tidal-lock, host planet.
- Picking: moons are pickable bodies (they already get the `PICK_PX` halo).
- Location tree: add the **Moon** level under Planet (the tree already reserves
  Universe → Galaxy → System → Planet → Moon; it was deferred until moons exist).

## 5e — Minor moons (lazy, clickable) — Pierre chose Option A

Real giants have dozens–hundreds of tiny *irregular* satellites (Jupiter ~90,
Saturn ~140): small captured rocks (1–10 km) on large, eccentric, often inclined
/ retrograde orbits. Model them as **real, clickable entities** — but
**lazy-spawned only for the planet the camera is focused on**, and despawned when
focus moves, so the live entity count stays bounded (~hundreds for one giant, not
the 10⁴–10⁵ that eager per-sector spawning would create and tax every frame).

- **Trigger:** when a planet is the camera's focus (selected, or its Hill sphere
  fills enough of the view), spawn its minor moons; despawn on leaving. Major
  moons stay eagerly spawned with the system (only a handful).
- **Data:** same `hashMoon(systemSeed, planetIndex)` stream, continued past the
  major moons; minor moons are smaller, farther out (toward the Hill radius),
  higher-eccentricity / inclined, some retrograde.
- **Render:** a swarm of the smallest morph markers around the giant; **do not
  label them all** (only major moons get names on-canvas); still pickable →
  clicking one opens its inspector.
- **Count:** a separate minor-moon count per giant (~tens, capped for sanity),
  independent of the major-moon count.

Deferred to last — do after major moons (5a–5d) and once Pierre has seen a system.

## Sub-phases (checklist)

- [x] **5a — Moon-count realism.** Revise `sampleMoonCount` to a per-type minimum
      + geometric-tail (true-mean) model as clearly-named local constants
      (consistent with the IMF / mass–radius params); one draw kept, so only counts
      shift; test that giants are never moonless. **Superseded** by a
      physics-driven count model — see
      [moon-count-physics.md](moon-count-physics.md) (count emerges from mass +
      Hill sphere; fixes the inspector = visible mismatch and the phantom cap).
- [x] **5b — Moon body generation.** `hashMoon`, moon orbit + physical sampling,
      spawn moon entities; `MoonPhysicalDef` (or reuse planet fields); determinism
      test (independent hash → planets byte-identical).
- [ ] **5c — Rendering.** Moon markers via the morph + moon orbit rings.
- [ ] **5d — Inspector + picking + nav tree.** Moon panel, moon selection, the
      Moon tree level.
- [ ] **5e — Minor moons.** Lazy, focus-driven spawn/despawn of the tiny irregular
      satellites as real clickable entities (Option A).
- [ ] Build + tests + lint; peer review; browser-tune (moon counts, floor tier,
      orbit spread).

## Decisions (from Pierre)

- **Major moons:** all rendered as real, clickable/inspectable bodies (~0–12).
- **Minor moons:** yes — **Option A** (real, clickable, lazy-spawned per focused
  planet), as 5e above.
- **Moon-count numbers:** the proposed mins/means/cap are fine; browser-tune later.
- **"Frame this planet" zoom:** deferred — folds into the generic "zoom to" TODO,
  not built here.
