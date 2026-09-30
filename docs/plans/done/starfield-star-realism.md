# Starfield star realism — brightness, size, colour

Make the individual background stars read like a real sky instead of an even
"snow" of look-alike dots: most stars faint, a few bright; bright stars larger
with a soft halo; colours mixed per star rather than painted by region.

> Parent feature: [background-starfield.md](background-starfield.md)
> (workstream C of [system-visuals.md](../system-visuals.md)).
> Visual only; touches `src/render/three/starfield.ts` (+ tests).

## 1. Problem

In `generateStars` every accepted star is treated almost identically:

1. **Flat brightness distribution.** `bright = STAR_DIM + rand() * STAR_BRIGHT_RANGE`
   is uniform over [0.18, 1.0], so bright stars are as common as mid ones. A real
   sky is dominated by faint stars with only a handful of bright ones (a steep
   luminosity function), which is what gives it depth.
2. **Constant sprite size.** `fillStars` scales every quad by `STAR_ANGULAR_SIZE`,
   so brightness is carried only by colour intensity. Perceived star size grows
   with brightness (eye / camera point-spread + glare).
3. **Regional colour.** Colour is `populationColor(activity)` where `activity`
   comes from the sampled direction, so neighbouring stars share one tint and the
   sky reads as colour zones. Real star colours are mixed everywhere: mostly
   white / yellow-white, some orange, few blue-white.
4. **No halos.** Pre-multiplied sky colours peak at 1.0, below the system-tier
   `BLOOM_THRESHOLD` (1.5), so no background star ever blooms.

## 2. Design

All changes live in star generation / instance fill; the renderer, dome
placement, band texture and caching are untouched.

### 2.1 Brightness — skewed distribution

Replace the uniform draw with a power-of-uniform draw, which concentrates mass at
the faint end:

```
bright = STAR_DIM + STAR_BRIGHT_RANGE * u ** STAR_BRIGHT_EXPONENT   // u ∈ [0,1)
```

- `STAR_BRIGHT_EXPONENT` (≈ 3–5) is the tuning knob: higher = fewer bright stars.
- `STAR_DIM` may need raising slightly so the (now much larger) faint population
  stays visible; the overall sky must not simply get darker. Tuned in-browser.

### 2.2 Halos for the brightest few — reuse bloom

For the top tail (`bright` above `STAR_HALO_START`, ≈ top 0.5 %), boost the
pre-multiplied colour above `BLOOM_THRESHOLD` (up to `STAR_HALO_PEAK`, ≈ 2.5) so
the existing system-tier bloom pass draws a soft halo for free. No new texture or
pass. If bloom halos read too large, fall back to size-only (2.3).

### 2.3 Size — tied to brightness

Store a per-star scale in `StarData` (new `sizes: Float32Array`) and apply it in
`fillStars`:

```
scale = STAR_ANGULAR_SIZE * lerp(STAR_SIZE_MIN, STAR_SIZE_MAX, (bright - STAR_DIM) / STAR_BRIGHT_RANGE)
```

With `STAR_SIZE_MIN` ≈ 0.7 and `STAR_SIZE_MAX` ≈ 2.0, faint stars get slightly
smaller than today and bright ones visibly larger.

### 2.4 Colour — per-star, regionally biased

Keep the existing warm → white → cold ramp (`populationColor(t)`) but pick `t`
per star from a distribution centred on white (0.5) with tails:

```
t = clamp(0.5 + STAR_TINT_SPREAD * triangular(rand, rand) + STAR_REGION_BIAS * (activity - 0.5), 0, 1)
```

- `triangular` = `rand() - rand()` (peaks at 0), so most stars are near white.
- `STAR_REGION_BIAS` (≈ 0.3) keeps a gentle regional lean (bluer toward active
  regions), so the galaxy context still shows, without colour zones.

### 2.5 Testability

Extract the per-star maths as pure exported helpers — `starBrightness(u)`,
`starScale(bright)`, `starTint(u1, u2, activity)`, `starIntensity(bright)` — and
unit-test them in `starfield.test.ts` (no DOM / Three needed).

## 3. Notes

- **Determinism:** still a pure function of `seed + galaxy + position bucket`.
  Extra `rand()` draws per accepted star shift the RNG stream, so the sky pattern
  changes once; nothing feeds back into generation, sim, or gameplay.
- **Perf:** a few extra `rand()` calls per accepted star and one extra
  `Float32Array`; negligible against the ~70 ms rebuild (tracked in
  [roadmap.md](../../roadmap.md)).
- **Out of scope** (tracked in [roadmap.md](../../roadmap.md) → Rendering and
  visuals): textured Milky-Way band, intergalactic-void sky, real neighbouring
  systems as the brightest sky stars.

## 4. Steps

- [x] **4.1** Add pure helpers (`starBrightness`, `starIntensity`, `starScale`,
  `starTint`) + tunable constants in `starfield.ts`.
- [x] **4.2** Use them in `generateStars`; add `sizes` to `StarData`.
- [x] **4.3** Apply per-star scale in `fillStars`.
- [x] **4.4** Unit tests: brightness median well below mid-range and monotonic;
  scale monotonic within [MIN, MAX]·base; tint mostly near white and within
  [0, 1]; only the top tail exceeds `BLOOM_THRESHOLD`.
- [x] **4.5** Update `docs/features.md` (Background starfield row).
- [x] **4.6** Static pipeline: `npm run build`, `npm test`, lint.
- [x] **4.7** Peer review (fast model, lightweight).
- [x] **4.8** Pierre browser-tunes exponent, dim floor, size range, halo tail,
  tint spread / region bias.

## 5. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-09-30 | Scope of the starfield upgrade | Stars only (brightness, size, colour) first; textured band and the void / real-neighbour sky ideas go to the roadmap. |
| 2026-09-30 | How to draw halos on the brightest stars | Reuse the existing bloom pass by pushing the top tail above `BLOOM_THRESHOLD`; no new texture/pass unless it looks wrong. |
