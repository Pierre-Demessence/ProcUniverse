# Phase E — Galaxy placement (eliminate the grid)

Elaborates **Phase E** of [realistic-simulation.md](realistic-simulation.md). Replace the
jittered lattice star placement with a **galaxy density field** so the star field looks like a
galaxy (core + arms, finite extent) instead of a grid, and make the zoomed-out glow show the same
shape.

## Goal & scope

- Replace the `SUBGRID×SUBGRID` jittered-lattice placement in
  [generateSectorData](../../src/generation/universe.ts) with points drawn from a seeded galaxy
  **density field** (denser in core/arms, falling to empty beyond a finite radius).
- Derive a galaxy **shape** (spiral or elliptical) + parameters as a pure function of the world seed.
- Make the galaxy-tier glow ([draw-galaxy.ts](../../src/render/draw-galaxy.ts)) sample the **same**
  density field, so zooming out reveals the actual galaxy structure rather than uniform noise.

### Non-goals (stay in Phase G / later)

- Multiple galaxies, intergalactic space, central black holes (Phase G).
- Physically-realistic absolute stellar number density — keep roughly the current count per region;
  Phase E changes the **pattern**, not the magnitude or the AU/ly scale.
- Poisson-disc minimum spacing — a density-modulated Poisson process (rejection sampling) is enough
  to kill the lattice; true blue-noise across sector seams is out of scope.
- Reintroducing any **positional** remap. The density field modulates *placement probability* only;
  star positions stay true-scale. (A radial position remap is the scrapped `scaleCompression`
  fisheye — do not rebuild it.)

## Design

### Placement = inhomogeneous Poisson via per-sector rejection sampling

For each sector, seed the placement RNG from `hashSector(seed, sx, sy)` (unchanged) and:

1. Draw a fixed `N = STAR_DENSITY_PEAK` candidate positions uniformly in the sector (no lattice).
2. Keep each candidate with probability `rho = galaxyDensity(galaxy, x, y)` (normalised to `[0,1]`,
   `1` at the core).
3. For each **kept** candidate `i`, seed a separate physics RNG from `hashSystem(seed, sx, sy, i, 0)`
   and sample the star + planets from it (decouples physics from placement bookkeeping → robust
   determinism; rejected candidates cost only the 2 position draws + 1 accept draw).

This is seamless across sector boundaries (each point is accepted independently against a global
continuous field), grid-free (uniform candidates), and density follows the galaxy shape. Expected
stars per sector ≈ `STAR_DENSITY_PEAK × avg(rho)` — ~`STAR_DENSITY_PEAK` at the core, ~0 past the rim.

### Galaxy parameters + density field — new `generation/galaxies.ts`

- `hashGalaxy(worldSeed)` (new in [hash.ts](../../src/generation/hash.ts)) → galaxy RNG.
- `GalaxyParams` (pure fn of the seed): `type: 'spiral' | 'elliptical'`, `scaleLength`, `radius`
  (finite cutoff), `arms`, `pitch`, `armStrength`, `phase`, `orientation`, `ellipticity`.
  Center fixed at the **world origin** for v1 (so the startup camera, framed on the origin sector,
  begins in the dense core); Phase G will place centers via `hashGalaxy` per galaxy index.
- `galaxyDensity(galaxy, x, y) → [0,1]` (representative, all tunable):
  - radius `r`, angle `theta` from center (apply `orientation` rotation; for elliptical, squash by
    `ellipticity`).
  - radial term: `exp(-r / scaleLength)` (exponential disc), optional core bulge boost.
  - spiral arms (spiral only): `arm = (0.5 + 0.5·cos(arms·(theta − ln(r)/tan(pitch)) − phase))^k`;
    combine `rho = radial · (1 − armStrength + armStrength·arm)`.
  - elliptical: `rho = radial` (no arm term).
  - hard cutoff `rho = 0` for `r > radius` (finite galaxy; empty space beyond until Phase G).

### Galaxy-tier glow consistency

In [draw-galaxy.ts](../../src/render/draw-galaxy.ts), replace the random `hashSector(seed ^ SALT)`
per-cell value with `galaxyDensity(galaxy, cellCenterX, cellCenterY)` for the glow's brightness/size,
keeping the existing power-of-two cell aggregation (bounded draw count). The zoomed-out view then
shows the core + arms.

### Config knobs (replace lattice knobs)

Remove `SUBGRID`, `EMPTY_CHANCE`, `JITTER_FRACTION`; add (with realistic-ish defaults, Pierre tunes):
`STAR_DENSITY_PEAK` (candidates/stars per core sector, ~ the old peak), `GALAXY_RADIUS_LY`,
`GALAXY_SCALE_LENGTH_LY`, `GALAXY_ARMS`, `GALAXY_ARM_PITCH`, `GALAXY_ARM_STRENGTH`,
`GALAXY_SPIRAL_CHANCE` (spiral-vs-elliptical odds). Phase/orientation/ellipticity are seeded, not knobs.

## Subtasks

- [x] `generation/galaxies.ts`: `GalaxyParams`, `makeGalaxy(worldSeed)`, `getGalaxy` (memoised),
      `galaxyDensity(galaxy, x, y)`.
- [x] `generation/hash.ts`: add `hashGalaxy(worldSeed)`.
- [x] `config.ts`: drop lattice knobs; add galaxy knobs.
- [x] `generation/universe.ts`: rewrite the placement loop to rejection sampling; decouple physics
      RNG via `hashSystem(seed, sx, sy, i, 0)`; re-key names on the system index.
- [x] `render/draw-galaxy.ts`: drive glow from `galaxyDensity` (derive the galaxy from the seed).
- [x] `main.ts` check: startup still frames a populated core system (a guaranteed-dense bulge at the
      origin keeps the start sector populated; the empty-sector fallback is retained).
- [x] Tests: `galaxies.test.ts` (peak at center, →0 past radius, arms modulate, deterministic per
      seed, spiral≠elliptical); `universe.test.ts` stays green; added a "not snapped to a lattice"
      scatter check on intra-sector positions.
- [x] Static pipeline green (`npm run lint`, `npm run build`, `npm test` — 82/82).
- [x] Peer review (fast model, no edits) — LGTM.
- [x] Docs: `features.md` (galaxy-structure row) + `codebase.md` (generation density field).
- [x] Browser E2E handed off to Pierre (no lattice; density varies with galactic position).

## Risks & watch-points

- **Determinism**: fixed draw order; physics RNG decoupled per accepted system; `universe.test.ts`
  determinism + "differs per sector/seed" must stay green.
- **Empty startup**: peak density at the origin must reliably populate the origin sector; keep
  `main.ts`'s empty-sector fallback. Consider guaranteeing `rho(origin) ≈ 1`.
- **Void cost**: rejection still does `N` cheap draws per sector even in empty space (bounded by
  `STAR_DENSITY_PEAK`, sectors cached) — acceptable.
- **Galaxy extent vs sector scale**: with `LY_PER_SECTOR = 0.01`, `GALAXY_RADIUS_LY` sets how many
  sectors the galaxy spans — a feel knob for Pierre.

## Open questions (confirm before building)

1. Galaxy size: how large should the explorable galaxy be (radius in ly / sectors)?
2. Shapes: spiral only for v1, or a spiral + elliptical mix from the seed?
3. Center at the world origin (simplest), or a seeded offset?
4. Keep the current ~per-sector star count, or change the density magnitude?
