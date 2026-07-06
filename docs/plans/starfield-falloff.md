# Starfield density falloff — quick-win polish

A small, self-contained tweak to the background starfield so its star density
**gradually** fades away from the galaxy plane, instead of the current "uniform
sprinkle everywhere + an abrupt bright stripe" look.

> Parent feature: [done/background-starfield.md](done/background-starfield.md)
> (workstream C of [system-visuals.md](system-visuals.md)).
> Independent of the 3D-galaxy work — operates on the current flat galaxy model.
> Status: **planning.** Not implemented.

## 1. Problem (Pierre's observation)

Inside a system you see roughly **uniform** faint stars in every direction,
**plus** a distinct band at one angle — as if two separate layers. Realistically
it should be a **single gradient**: densest along the galactic plane (the band),
thinning smoothly as you look away from it, down to almost nothing toward the
galactic poles.

## 2. Why it looks that way today

In `src/render/three/starfield.ts`, `generateStars` computes per-direction
acceptance probability as:

```
diskFactor = max(0, 1 - |z| * BAND_FALLOFF)      // BAND_FALLOFF = 8
density    = max(0.05, clamp(rawDensity * coreFactor * diskFactor, 0.05, 0.95))
```

Two things create the "uniform + stripe" read:

1. **The 0.05 floor applies everywhere.** Even where `diskFactor` is 0 (away
   from the plane) every direction still keeps ~5% of its candidate stars → a
   flat uniform field in all directions.
2. **`diskFactor` is a sharp linear clip.** With `BAND_FALLOFF = 8` it is
   non-zero only for `|z| < 0.125` (≈ ±7° of the plane) and hard-zero beyond →
   an abrupt stripe rather than a smooth gradient.

The Milky-Way band **texture** (`makeBandTexture`) uses the same
`BAND_FALLOFF`, so it inherits the same sharp edge.

## 3. The change (visual only)

Replace the sharp clip + flat floor with a **smooth falloff plus a small tapering
ambient term**, so density peaks at the plane and eases toward the poles:

- Swap the linear `1 - |z|·k` clip for a smooth profile, e.g.
  `diskFactor = exp(-(z / BAND_SIGMA)²)` (Gaussian) or a `smoothstep`, with a
  **wider** spread than today so the transition is gradual, not a stripe.
- Replace the flat `0.05` floor with a **small ambient floor that also tapers**
  toward the poles (a low uniform term for nearby foreground stars + the
  disk-weighted term), so the poles read as sparse — near-empty — rather than a
  uniform 5%.
- Apply the **same** smooth profile to `makeBandTexture` so the diffuse band and
  the star gradient agree in width and edge softness.
- Expose the shape as tunable constants (`BAND_SIGMA` / floor level) so Pierre
  can dial the look in-browser.

Keep everything else (uniform-sphere sampling, per-galaxy seeded RNG, colours,
instanced sprites) unchanged.

## 4. Notes

- **Determinism:** purely visual. The starfield is still a deterministic
  function of `seed + galaxy`; changing acceptance probabilities changes *which*
  candidates are kept (the sky pattern), but nothing feeds back into generation,
  sim, or gameplay.
- **Perf:** unchanged — same candidate count, same one-time-per-galaxy cost.
- **Scope:** this is the flat-galaxy polish only. The **direction-of-band /
  per-galaxy tilt / no-band-for-ellipticals / 3D-density** realism is a separate
  follow-up gated on the 3D-galaxy work, tracked in
  [rendering-backend.md](rendering-backend.md) **Stage 3**.

## 5. Steps

- [ ] **5.1** Replace `diskFactor` in `generateStars` with a smooth (Gaussian /
  smoothstep) profile + a tapering ambient floor; add `BAND_SIGMA` / floor knobs.
- [ ] **5.2** Match `makeBandTexture` to the same profile.
- [ ] **5.3** Static pipeline: build + tests + lint.
- [ ] **5.4** Peer review (fast model, lightweight).
- [ ] **5.5** Pierre browser-tunes the falloff width + floor.

## 6. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-06 | Do a combined "Z + starfield realism" plan? | **No** — the "Z for everything" half is already rendering-backend.md Stage 3, and the 3D-dependent starfield realism is tracked inline there. This plan stays the standalone flat-galaxy falloff quick win so it can reach `done/` on its own. |
| 2026-07-06 | Falloff shape | Smooth (Gaussian / smoothstep) + tapering ambient floor, replacing the linear clip + flat 0.05 floor. Exact width is Pierre's to tune. |
