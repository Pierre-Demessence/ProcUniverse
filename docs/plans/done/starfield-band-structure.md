# Starfield band structure — star clouds, dust lanes, clusters

Give the system-view sky depth by adding **structure**: a patchy Milky-Way band
with bright star clouds, dark dust lanes and a brighter bulge toward the galaxy
core, plus stars that clump (clouds, open clusters) instead of an even random
sprinkle. From a fixed viewpoint, depth is read from layering (bright clouds
behind dark lanes), not parallax, which is negligible across a system.

> Parent feature: [background-starfield.md](background-starfield.md);
> follows [starfield-star-realism.md](starfield-star-realism.md).
> Visual only; flat-galaxy model (3D-galaxy realism stays in
> [rendering-backend.md](../rendering-backend.md) Stage 3).

## 1. Problem

- `makeBandTexture` paints the band as a smooth Gaussian per row: same width,
  colour and brightness all the way round, identical for every galaxy.
- Star positions are uniform random, thinned only by the smooth plane falloff,
  the toward-core factor and `galaxySampleAt` density (sampled 50 kAU out, so
  nearly constant across the sky). They form an even sheet with no clumping.
- Band and stars share only `diskWeight`; any band detail added in isolation
  would disagree with where the stars are.

## 2. Design

One **coarse sky-structure map** is the shared source of truth for both the band
glow and the star density, so they always agree. Fine grain is added on the GPU
for the band only (purely cosmetic; no need for the stars to match it).

### 2.1 Sky-structure field (new pure module)

`src/render/three/sky-structure.ts`, no Three.js dependency, unit-tested:

- A small seeded 3D value-noise fBm evaluated on the **unit world direction**
  (3D noise on the sphere avoids pole pinching and the azimuth seam).
- `skyStructure(dir, ctx) → { glow, dust, bulge }` with `ctx` = seeded noise +
  toward-core direction:
  - **Band with wavy edges:** `diskWeight(z + warp)`, where `warp` is
    low-frequency noise, so the band's edges and thickness vary with longitude.
  - **Star clouds:** fBm contrast-stretched, multiplied into the band →
    bright patches and gaps along it.
  - **Bulge:** a wider, taller glow centred on the toward-core direction
    (`exp(-angle² / σ²)`, larger vertical extent than the disk).
  - **Dust lanes:** ridged noise (`1 - |n|`) thresholded into thin filaments,
    confined to a narrower plane layer than the stars and strongest on the
    core-ward half; `dust ∈ [0,1]` is opacity.
- `bakeSkyStructure(ctx, width, height)` fills an equirectangular map
  (RGBA8: cloud, dust, bulge, disk) with the **existing `pixelToDir`
  convention** (world axes, galactic plane at z = 0). Default 512×256.

### 2.2 Band rendering

Replace the `MeshBasicMaterial` + canvas band texture with a
`MeshBasicNodeMaterial` (TSL, as in `star-material.ts`):

- The band sphere is **not rotated**; the shader takes
  `normalize(positionLocal)` as the world direction and computes equirect UVs
  from it (inverse of `pixelToDir`), so map texels and star directions line up
  by construction. Map uses linear filtering, no mipmaps (no wrap seam).
- `glow = (disk × mix(CLOUD_GLOW_FLOOR, 1, cloud) × BAND_BRIGHTNESS + bulge ×
  BULGE_BRIGHTNESS) × (1 − dust × DUST_GLOW_OPACITY) × fineDetail`, where
  `fineDetail` is `mx_fractal_noise_float` on the direction — adds grain
  sharper than a map texel. The sky's angular scale is fixed (constant FOV),
  so per-pixel noise does not shimmer.
- Colour: cool white away from the core → warm yellow in the bulge
  (`map.bulge`); additive blend, depth-test, no depth-write, as today.
- Peak brightness above the current 5% `BAND_BRIGHTNESS`, tuned by eye.
- Fallback if per-pixel cost shows up: bake once via `createSurfaceBake`.

### 2.3 Star density follows the structure

In `generateStars`, the acceptance probability gains
`× disk × lerp(STAR_CLOUD_MIN, STAR_CLOUD_MAX, cloud) × (1 + BULGE_STAR_BOOST ×
bulge)` on the galactic term (the warped `disk` replaces the old `diskWeight(z)`)
and `× (1 − dust × DUST_STAR_OPACITY)`, reading
the **same baked map** (bilinear lookup; cheaper than re-evaluating noise for
180 k candidates and guarantees agreement). Stars crowd into clouds and thin out
behind dust lanes.

### 2.4 Open clusters

After the main loop, place `CLUSTER_COUNT` (≈ 6–12) seeded cluster centres near
the plane (skipping heavy dust). Each adds 20–80 stars in a small angular radius
(≈ 0.3–1.5°, Gaussian falloff), biased brighter and bluer (young stars). Total
stars stay ≤ the instanced-mesh capacity.

### 2.5 Caching and lifecycle

- The map depends on `seed + galaxy + position bucket` (core direction), i.e.
  the existing `cacheKey`; cache it inside `StarData` (512×256×4 = 512 KB,
  ≤ 8 entries). On key change, upload it to the band's `DataTexture`.
- Void: band hidden, no clusters, structure factor = 1 (unchanged look).

## 3. Notes

- **Determinism:** pure function of `seed + galaxy + bucket`; nothing feeds
  back into generation, sim or gameplay.
- **Perf:** map bake ≈ 30 ms at 512×256 (Node benchmark; cloud / dust use
  3 octaves, rows beyond |z| = 0.75 are skipped); star lookup adds ≈ 15 ms of
  bilinear reads over 180 k candidates. Both run only on a cache miss. The existing ~70 ms rebuild item stays in
  [roadmap.md](../../roadmap.md).
- **Out of scope** (in [roadmap.md](../../roadmap.md)): coloured nebulae
  (emission / reflection), void sky, real-neighbour stars.

## 4. Tunable constants

`BAND_BRIGHTNESS`, `BAND_WARP`, `CLOUD_SCALE` / `CLOUD_CONTRAST`,
`BULGE_SIGMA` / `BULGE_BOOST`, `DUST_SCALE` / `DUST_THRESHOLD` / `DUST_OPACITY`,
`DUST_STAR_OPACITY`, `STAR_CLOUD_WEIGHT`, `CLUSTER_COUNT` / cluster size range,
`FINE_DETAIL_SCALE` / `FINE_DETAIL_AMOUNT`, map resolution.

## 5. Steps

- [x] **5.1** `sky-structure.ts`: seeded 3D value-noise fBm, `skyStructure`,
  `bakeSkyStructure` + unit tests (determinism, ranges, band concentrated near
  z = 0, bulge peaks toward the core, dust present but sparse, bake timing).
- [x] **5.2** Equirect UV helper `dirToUv` (inverse of `pixelToDir`) + test
  that they round-trip.
- [x] **5.3** Band node material: unrotated sphere, map lookup, dust darkening,
  fine detail, bulge colour; delete `makeBandTexture`.
- [x] **5.4** Star density reads the map (clouds + dust); map cached in `StarData`.
- [x] **5.5** Open clusters; respect instanced capacity.
- [x] **5.6** Update `docs/features.md`, `docs/codebase.md`,
  `docs/agent/README.md`, file header comment (the roadmap band item is removed
  when this plan moves to `done/`).
- [x] **5.7** Static pipeline: `npm run build`, `npm test`, lint.
- [x] **5.8** Peer review (fast model, lightweight).
- [x] **5.9** Pierre browser-tunes band brightness, cloud contrast, dust,
  bulge, clusters, fine detail.

## 6. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-09-30 | Why structure, not real 3D star distances? | Parallax across a system is sub-pixel; depth in a still sky comes from layering. Real-neighbour stars stay on the roadmap for the system → sector zoom. |
| 2026-09-30 | How to keep band and stars consistent | One coarse CPU-baked structure map drives both; GPU fine detail is band-only cosmetic grain. |
| 2026-09-30 | Band orientation | Drop the mesh rotation; shader derives the world direction from the unrotated sphere so map, band and stars share `pixelToDir`. |
