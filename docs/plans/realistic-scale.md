# Realistic spatial scale (full-real rescale)

Make the **interstellar and galactic scale** realistic: stars light-years apart
inside Milky-Way-sized galaxies, instead of the toy scale (stars tens-to-hundreds
of AU apart inside a 2.5 ly galaxy). This is Phase 3b of
[system-scale-realism](system-scale-realism.md), split out because it is a
cross-cutting rescale of the galaxy model + LOD tiers + zoom range.

## Decision

Go **fully realistic on the data** and make navigation usable later with
**rendering/navigation tricks** (the standard space-sim approach). The hard part
— numerical precision at vast coordinates — is already solved by the existing
floating-origin rebase (star-local origin at system tier, `REBASE_SECTORS` snap
when zoomed out). The other foundations already exist too: accelerating zoom, the
LOD tiers (which collapse empty space), and selection/tree-view. The one genuinely
new trick, **warp/fly-to-target**, is deferred to the rendering phase.

Interim expectation: between this rescale and building warp-to-target, manual
navigation across interstellar space feels vast — accepted, deliberate.

## Why it's coupled

Star spacing `= SECTOR_SIZE / √(stars per sector)`. Realistic light-year spacing
needs `LY_PER_SECTOR` ~100× larger; but the galaxy is only 2.5 ly (~500 sectors),
so it must scale up too, which ripples to the galaxy cell grid, the LOD tier
thresholds (defined in sectors-across), and the zoom range.

## Knob changes (first pass — Pierre browser-tunes the tier/zoom feel)

| Knob | Old | New | Rationale |
|---|---|---|---|
| `LY_PER_SECTOR` | 0.01 | **1** | stars ~0.1 ly (core) to ~few ly (disk) apart |
| `GALAXY_RADIUS_LY` | 2.5 | **50000** | Milky-Way-sized stellar disc |
| `GALAXY_SCALE_LENGTH_LY` | 0.5 | **10000** | real disc scale length |
| `GALAXY_CELL_LY` | 80 | **2000000** | galaxies ~Mly apart (Andromeda 2.5 Mly) |
| `GALAXY_FIELD_SECTORS` | 8000 | **300000** | galaxy→field must exceed a galaxy's ~130k-sector diameter |
| `UNIVERSE_SECTORS` | 80000 | **100000000** | field→universe when galaxies (2M sectors apart) blur into the cosmic glow |
| `MIN_ZOOM` | 1e-8 | **1e-12** | reach the now-vast universe tier |

Unchanged: `STAR_DENSITY_PEAK` (100 — at the new scale this yields ~6×10¹⁰
stars/galaxy, realistic, for free), `GALAXY_TIER_SECTORS` (16 — star→galaxy at
~16 ly is a sensible perf/visual point), `SYSTEM_TIER_MAX_AU`, `SYSTEM_VIEW_AU`,
`REBASE_SECTORS`, `MAX_ZOOM` (all system-scale or relative, unaffected).

## What does NOT need changing (verified)

- `scale.ts` `SECTOR_SIZE` derives from `LY_PER_SECTOR` — auto-updates (now
  ~63,241 AU).
- `tier.ts` `STAR_AT = SYSTEM_TIER_MAX_AU / SECTOR_SIZE` — auto-derived.
- The galaxy density / 3×3 dominant-cell scan still holds: galaxy radius
  (~65,000 ly with size scatter) ≪ cell (2,000,000 ly), so only an immediate
  neighbour cell can reach in.
- `galaxies.test.ts`, `scale.test.ts`, `universe.test.ts` derive positions from
  the constants (`cell·AU_PER_LY`, `SECTOR_SIZE`) or assert structural
  properties — auto-adapt.
- Orbital architecture (Phases 1–3) is in AU, independent of this rescale.

## Coupling that DOES need handling

- **`tier.test.ts`** hardcodes sectors-across values mapping to the *old* tier
  boundaries (`20000`→galaxy-field, `200000`→universe). Rewrite to derive test
  points from the boundary constants so it auto-adapts.

## Precision (already handled, noted for confidence)

Absolute coordinates can reach ~10¹²–10¹³ AU; float64 keeps ~15–16 significant
digits, so absolute precision is ~10⁻³ AU at the far edge — irrelevant for
navigation. Rendering precision is preserved by the floating origin: the
star-local origin keeps system-tier disc coords at ~tens of AU, and
`REBASE_SECTORS` keeps zoomed-out render coords within ~8 sectors; the dot/glow
tiers pass screen coords (not world coords) to the canvas.

## Known follow-ups (deferred, not blockers)

- **Warp / fly-to-target** navigation (rendering phase) — the main usability trick.
- **Zoom feel**: the range is now ~16 orders of magnitude; the accelerating zoom
  covers it (~50 notches), but Pierre may bump `ZOOM_STEP_MAX`.
- **Startup framing**: the home SMBH sits in a now-vast core; the 40 AU startup
  frame shows the SMBH with the nearest star ~0.1 ly away (empty-ish). Pierre may
  retune the startup framing.

## Checklist

- [x] Rescale the 7 knobs in `config.ts` + update the affected comments.
- [x] Rewrite `tier.test.ts` to derive test points from the boundary constants.
- [x] Fix `galaxies.test.ts` star-count tests (realistic local fixtures; the
      toy-sized shared fixture now rounds to 0 stars against the larger sector).
- [x] Build + tests (171) + lint green; sector-width guard still holds
      (63,241 AU ≫ 150 AU disk cap).
- [x] Peer review (fast model) — LGTM; confirmed no perf cliff / unbounded
      iteration (streaming + render aggregation are viewport-bounded, not
      universe-scale-bounded) and determinism preserved.
- [ ] Hand off to Pierre: browser-tune tier transitions, zoom feel, startup frame.
