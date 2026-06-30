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

## Phase 2 — Apparent size (rendering) — NOT STARTED

- Move the apparent-size decision out of the data layer: the data carries only the
  true physical radius; the renderer computes drawn size from `(trueRadius, zoom)`.
- Ordered, non-overlapping size **floors** (every star floor > every planet floor)
  so stars always dominate planets when zoomed out.
- **Morph:** as you zoom in, true physical size takes over once
  `physicalRadius × zoom` exceeds the floor — so flying up to a body shows its real
  scale (huge star, tiny planet against its orbit). No render-space distance warp
  (a radial distance compression is a fisheye — already tried and scrapped).

## Phase 3 — Moons — NOT STARTED

Moons are the same model one level deeper (a body that becomes relevant only at a
much tighter zoom, with its own sub-framing). Generate around planets, render with
the Phase-2 floors/morph, expose in the inspector. Deferred until Phase 1–2 settle
the scale model.

## Deferred realism options (noted, not scheduled)

These improve realism further but the current behaviour isn't strictly wrong, so
they are parked here for later (research §5.1 already calls for both):

- **Frost-line-aware spacing.** Real systems aren't uniformly geometric — they have
  a compact inner region and widely-spaced outer giants beyond the frost line. The
  generator already computes `beyond = a >= frostLine(L)`; applying a wider ratio
  (e.g. 1.6–2.6) beyond the frost line would produce realistic inner-cluster +
  outer-giant architectures and far more reliably place distant planets.
- **Star-scaled orbital bounds.** Orbits are placed in fixed AU regardless of the
  star; realistically the inner edge (dust sublimation, ∝ √L) and the whole disk
  scale with stellar mass/luminosity, so planets track the habitable zone / frost
  line instead of being all-frozen around dim stars and all-roasted around bright
  ones. Bigger change with wide ripple effects (periods, temperatures, naming).
