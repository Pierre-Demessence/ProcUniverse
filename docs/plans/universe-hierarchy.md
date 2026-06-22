# Phase G — Galaxy & universe hierarchy

Elaborates **Phase G** of [realistic-simulation.md](realistic-simulation.md): wrap the single
Phase-E galaxy into a **universe of many galaxies**, each with a central black hole, reusing the
existing streaming + floating-origin + LOD machinery.

## Key realisation — no hierarchical-addressing rewrite needed (yet)

The research (§6) assumes realistic galaxies (~100,000 ly), which would overflow the 32-bit sector
hash and float64 precision, forcing galaxy-relative addressing. **But this game runs a compressed
scale**: `LY_PER_SECTOR = 0.01`, galaxy radius `2.5 ly` (~250 sectors). At that scale a galaxy
separation of ~30× (research §6.2) is ~75 ly ≈ 7,500 sectors, and the whole 32-bit sector range
(±2.1e9 sectors ≈ ±21 Mly ≈ ±1.3e12 AU) is **exact in float64** and holds hundreds of thousands of
galaxies. So Phase G keeps **absolute AU/sector coordinates** and adds a galaxy-placement layer on
top — the existing `SectorCache`, `SystemStreamer`, tier selection, and sector-grid floating origin
are reused unchanged. (Full galaxy-relative addressing is only needed if we ever switch to realistic
galaxy sizes — out of scope.)

## Design

### Galaxy layer — generalise the single galaxy to a grid

- **Coarse galaxy grid**: the universe is tiled into galaxy cells of `GALAXY_CELL_LY` (chosen so a
  cell comfortably exceeds a galaxy diameter; the 30× separation lives here). Each cell `(Gx, Gy)` is
  seeded by `hashGalaxy(worldSeed, Gx, Gy)` and holds **one** galaxy with an occupancy roll, a center
  jittered within the cell, and the Phase-E shape params — sparse + jittered so it never reads as a
  lattice (cosmic-web clustering is a later refinement; research §6.2 says a uniform field is a fine
  v1).
- `GalaxyParams` gains `centerX, centerY` (AU) and `blackHoleMass` (M☉). `makeGalaxy` becomes
  `makeGalaxy(worldSeed, Gx, Gy)`; `hashGalaxy` takes `(worldSeed, Gx, Gy)` (extend its fold).
- `galaxyDensityAt(worldSeed, x, y)` = max density over the ≤9 galaxies in the 3×3 neighbouring
  galaxy cells (bounded, O(1), deterministic; overlap-safe via max). `galaxyAt(worldSeed, x, y)`
  returns the dominant galaxy (for naming / black hole / inspector context).

### Star placement & glow consume the galaxy layer

- `generateSectorData` swaps the single `getGalaxy` for `galaxyDensityAt` / `galaxyAt`: a sector's
  candidates are kept against the local galaxy's density (relative to **its** center); sectors in the
  intergalactic void are empty. Determinism is unchanged (per-system `hashSystem` streams).
- `draw-galaxy.ts` samples `galaxyDensityAt`, so zooming out shows **every** galaxy as a glow — the
  existing power-of-two aggregation already turns this into the "galaxy field" view for free.

### Central black holes (research §6.3)

- New `BlackHole` component `{ mass, schwarzschildRadius }` (M☉, AU). `blackHoleMass` derives from
  galaxy scale via an M–σ-style scaling with seeded scatter (~1e6–1e10 M☉, Sgr A*→M87*);
  `r_s = 2GM/c²` stored as data (tiny, like a star's radius).
- `spawnSector` spawns a stylised black-hole marker entity at the galaxy center when that center's
  sector streams in. It is pickable at the system tier; the inspector gains a black-hole panel
  (mass, `r_s`, host galaxy name).

### LOD tiers

The existing `system / star / galaxy` tiers + aggregation already render many galaxies as glows. A
**dedicated galaxy-field / universe (cosmic-web) tier** with per-galaxy sprites/labels and clustered
placement is a **later refinement** (G2), not required for a navigable multi-galaxy universe now.

## Suggested sub-phasing

- **G1 (this plan's focus): a navigable multi-galaxy universe.** Galaxy grid + `galaxyAt` /
  `galaxyDensityAt`; star placement & glow consume it; central black holes + inspector panel. Reuses
  all existing tiers/streaming. Ships "fly between galaxies, each with a core black hole."
- **G2 (later): cosmic structure & polish.** Dedicated galaxy-field + universe tiers (sprites,
  labels), cosmic-web clustered galaxy placement, galaxy-glow picking (inspect a galaxy), and — only
  if realistic galaxy sizes are ever wanted — galaxy-relative hierarchical addressing.

## G1 subtasks (draft — pending scope confirmation)

- [ ] `hash.ts`: `hashGalaxy(worldSeed, Gx, Gy)` (fold the galaxy-cell coords).
- [ ] `galaxies.ts`: galaxy grid (`GALAXY_CELL_LY`, occupancy, jittered center), `centerX/centerY` +
      `blackHoleMass` on `GalaxyParams`, `makeGalaxy(worldSeed, Gx, Gy)`, `galaxyAt` /
      `galaxyDensityAt` (3×3 scan), M–σ black-hole mass + `r_s`.
- [ ] `config.ts`: `GALAXY_CELL_LY`, galaxy occupancy, black-hole mass range/scatter knobs.
- [ ] `universe.ts`: place stars against `galaxyDensityAt` / the local galaxy center.
- [ ] `draw-galaxy.ts`: glow from `galaxyDensityAt` (all galaxies).
- [ ] `BlackHole` component + `spawnSector` marker at galaxy centers; register in `main.ts`.
- [ ] `pick.ts` + `inspector.tsx`: black-hole hit-testing + panel (mass, `r_s`, host).
- [ ] Tests: galaxy-grid determinism, `galaxyAt` picks the right galaxy / null in voids, density
      continuity, M–σ monotonicity; `universe.test.ts` stays green.
- [ ] Static pipeline + peer review + docs; browser E2E to Pierre.

## Risks & watch-points

- **Galaxy lattice look**: keep galaxies sparse + jittered (and prefer the Phase-E rejection style
  over a hard grid) so the galaxy field isn't a visible grid — the same lesson that motivated Phase E.
- **`galaxyAt` correctness at cell edges**: galaxy radius must be `< GALAXY_CELL`, so the 3×3 scan is
  sufficient; assert this in a test.
- **Determinism**: `hashGalaxy(worldSeed, Gx, Gy)` must keep the per-galaxy stream independent of the
  per-sector/per-system streams (distinct folds), as in Phase E.
- **Empty intergalactic void**: navigability between galaxies leans on zoom-out showing galaxy glows
  + accelerating zoom; confirm the void feels crossable (else pull G2's galaxy-field tier forward).

## G1 subtasks (confirmed scope)

Decisions (Pierre): compressed scale + absolute coords (no hierarchical-addressing rewrite);
inspectable central black holes; light position-based **population coloring** (blue arms, red
cores/ellipticals) without age/evolution; galaxy **types** spiral, barred-spiral, elliptical,
lenticular + a dwarf size roll (irregular deferred to G2), drawn by realistic field fractions,
random across the universe (cosmic-web clustering deferred to G2).

- [x] `hash.ts`: `hashGalaxy(worldSeed, Gx, Gy)` (fold the galaxy-cell coords).
- [x] `galaxies.ts`: galaxy grid (`GALAXY_CELL_LY`, occupancy, jittered center); morphology draw
      (spiral/barred-spiral/elliptical/lenticular by field fractions) + dwarf size roll; bar term for
      barred; `centerX/centerY`, `blackHoleMass`, `schwarzschildRadius` on `GalaxyParams`;
      `makeGalaxy(worldSeed, Gx, Gy)`; `galaxyAt` / `galaxyDensityAt` / `galaxyActivityAt` (3×3 scan);
      M–σ-style black-hole mass from galaxy size + scatter. A **home galaxy** at the origin keeps
      startup populated.
- [x] `config.ts`: `GALAXY_CELL_LY`, `GALAXY_OCCUPANCY`, `GALAXY_DWARF_CHANCE`, black-hole mass range,
      population-bias strength.
- [x] `stars.ts`: `sampleStellarMass(rng, activity?)` / `sampleStar(rng, activity?)` — warp the IMF
      draw by activity (young→hot/blue, old→cool/red); omitting `activity` is unchanged (back-compat).
- [x] `units.ts`: Schwarzschild-radius constant (AU per M☉).
- [x] `universe.ts`: place stars against `galaxyDensityAt`, color by `galaxyActivityAt`; add
      `blackHoles` to `SectorData` for galaxy centers inside the sector.
- [x] `draw-galaxy.ts`: glow from `galaxyDensityAt`, tinted by `galaxyActivityAt` (blue arms / red
      cores) via a small cached color-ramp of sprites.
- [x] `BlackHole` component + `spawnSector` marker at galaxy centers; register in `main.ts`.
- [x] `pick.ts` + `inspector.tsx`: black-hole hit-testing + panel (mass, `r_s`, host galaxy).
- [x] Tests: galaxy-grid determinism, `galaxyAt` picks the right galaxy / null in voids, type draw,
      black-hole-mass monotonicity, activity high-on-arms; `universe.test.ts` stays green (87/87).
- [x] Static pipeline (lint / build / test) + peer review (LGTM) + docs.
- [ ] Browser E2E handed off to Pierre (fly between galaxies; varied morphologies + colours;
      inspect a black hole).
