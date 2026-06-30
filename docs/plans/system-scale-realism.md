# System scale realism

Make the in-system view convey realistic scale without losing usability. Two
TODO items drive this — "find a better way to preserve the scale when viewing a
solar system" and "add moons" — and they share one underlying model, so they are
planned together here.

## Problem

At true scale the dynamic range inside a system is ~10⁵–10⁶: a star is a
rounding error against its orbits, and a planet is invisible whenever its orbit
is on screen. Today ProcUniverse has two distinct issues:

- **Data (orbital architecture):** orbits only span ~0.35–8 AU, so planets are
  never very far out and inner close-in planets never appear. This is a realism
  gap in the generated data, fixable on its own.
- **Rendering (apparent size):** the exaggerated visual discs overlap
  (`starVisualRadius` ∈ [0.05, 0.70] AU, `planetVisualRadius` ∈ [0.02, 0.18] AU),
  so a big planet can render larger than a small star, and the disc is a fixed AU
  size at every zoom so true scale is never visible up close.

Real radii, masses, periods and temperatures are already physically correct — the
only data problem is *where planets are placed*.

## Phase 1 — Orbital architecture (data) — DONE (uncommitted)

Fix the three knobs that are genuinely unrealistic. Keeps the generator's
geometric (Titius–Bode-like) spacing, which is already realistic; just widens its
reach and lets close-in planets exist. This shifts the universe (every system
re-rolls), which is expected.

- [x] `ORBIT_INNER_AU` 0.25 → 0.04 — real systems are dominated by close-in
      planets (0.02–0.1 AU); an inner edge at 0.25 AU (beyond Mercury) misses them.
- [x] `PLANET_MAX` 5 → 8 — the solar system has 8; 5 caps both richness and reach.
- [x] `ORBIT_RATIO_MAX` 2.0 → 2.2 — lets some systems stretch toward Neptune-like
      distances (real big gaps reach 2–3.4×). `ORBIT_RATIO_MIN` (1.4) unchanged.
- [x] Keep `PLANET_MIN` (1) and `ECC_MAX` (0.4) — both already realistic
      (single-planet systems exist; e = u²·0.4 → mean ~0.13 matches multi-planet
      exoplanets).
- [x] Confirm build + tests + lint green (scale.test computes `widestOrbit` from
      the constants, so it auto-adapts: new max ≈ 0.04·2.2⁸ ≈ 22 AU < 632 AU sector).
- [x] Peer-reviewed (fast model) — LGTM, determinism preserved (no draw
      added/reordered; only the constant values fed to existing draws change).

Resulting reach: innermost planet 0.06–0.09 AU; outermost ~0.06 AU (sparse) to
~22 AU (max luck), most systems still compact.

## Phase 2 — Frost-line-aware spacing (data) — DONE (uncommitted)

Real systems aren't uniformly geometric: a compact inner region, then a gap and
widely-spaced outer giants beyond the frost line. Apply a wider ratio to cold
orbits so distant planets appear far more often (and dim stars, with close-in
frost lines, get cold giants without needing a huge planet count).

- [x] Add `ORBIT_RATIO_OUTER_MIN` (1.6) / `ORBIT_RATIO_OUTER_MAX` (2.5) knobs.
- [x] In `generateSectorData`, compute `frost = frostLine(L)` once per system; each
      gap takes one draw mapped to the outer range when `a >= frost`, else the inner
      range. One draw either way → deterministic stream unchanged; inner-only
      systems are byte-identical to Phase 1, only systems with cold planets shift.
- [x] Update `scale.test` worst-case guard to the true widest ratio
      (`ORBIT_INNER_AU · ORBIT_RATIO_OUTER_MAX ** PLANET_MAX` ≈ 61 AU) with a ×3
      sector margin (632 AU sector ⇒ 183 AU < 632, comfortable).
- [x] Regression test: across a 3×3 sector grid, cold planets (a ≥ frost) exist and
      the widest orbit exceeds 10 AU.
- [x] Build + tests (171) + lint green.

## Phase 3 — Star-scaled orbital bounds (data) — DEFERRED (next data item)

The remaining data realism gap (research §5.1). Orbits are placed in fixed AU
regardless of the star; realistically the inner edge (dust sublimation, ∝ √L) and
the whole disk scale with stellar mass/luminosity, so planets track the habitable
zone / frost line instead of being all-frozen around dim stars and all-roasted
around bright ones. Bigger change with wide ripple effects (periods, temperatures,
naming), so it is its own phase — do after Pierre confirms Phases 1–2 in browser.

## Phase 4 — Apparent size (rendering) — NOT STARTED

- Move the apparent-size decision out of the data layer: the data carries only the
  true physical radius; the renderer computes drawn size from `(trueRadius, zoom)`.
- Ordered, non-overlapping size **floors** (every star floor > every planet floor)
  so stars always dominate planets when zoomed out.
- **Morph:** as you zoom in, true physical size takes over once
  `physicalRadius × zoom` exceeds the floor — so flying up to a body shows its real
  scale (huge star, tiny planet against its orbit). No render-space distance warp
  (a radial distance compression is a fisheye — already tried and scrapped).

## Phase 5 — Moons — NOT STARTED

Moons are the same model one level deeper (a body that becomes relevant only at a
much tighter zoom, with its own sub-framing). Generate around planets, render with
the Phase-4 floors/morph, expose in the inspector. Deferred until the scale model
settles.
