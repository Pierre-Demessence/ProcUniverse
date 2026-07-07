# Planet Rings — a slice of the planet-surface overhaul

Workstream **G** of [system-visuals.md](system-visuals.md) and
[planet-surfaces.md](planet-surfaces.md). A translucent, tilted ring disc around
planets that have rings — **geometry first, appearance deliberately simple**.

> Status: **implemented** — green on build + tests + lint, peer-reviewed
> (LGTM), awaiting Pierre's browser check. Built with the default calls (flat /
> translucent, one gap, honour `hasRings` as-is); all knobs live in
> `planet-rings.ts` for tuning.

## 1. Why rings next (out of the planned order)

The planet **surface** slices (gas/ice giants, rocky) are shelved: their look is
judged purely by taste, and the agent has no way to see the output, so blind
iteration didn't converge. Rings are the opposite kind of work:

- **Mostly geometry** — a disc in the planet's equatorial plane, tilted with its
  axis, correct radius, translucent. Objectively right or wrong; verifiable.
- **No animation** — rings don't churn or flow, so none of the "degenerates into
  grain / doesn't feel alive" failure modes apply.
- **The appearance is 1-D** — brightness/opacity as a function of *radius* (a few
  concentric bands + a gap), with a simple, forgiving, well-known target
  (Saturn). Kept deliberately subtle so the floor is high.
- **High payoff** — the `hasRings` data exists but rings are **not drawn at all
  today**; adding them is an instantly recognizable upgrade.

So rings play to what the agent does reliably. Surface slices wait for a tighter
visual loop.

## 2. Goal

A planet flagged `hasRings` shows a thin, translucent ring disc lying in its
**equatorial plane** (so it tilts with the planet's axis and agrees with its moon
disk), scaled to the planet, with a soft radial brightness/opacity profile and
one clear gap (a Cassini-division cue). Subtle and tasteful, not flashy.

## 3. Approach

### 3.1 Geometry (the bulk — low risk)

- A flat annulus via three's `RingGeometry(inner, outer, segments)` (its own
  pooled mesh, like the sphere pools in
  [three-renderer.ts](../../src/render/three/three-renderer.ts#L345)).
- **Orientation = the planet's spin axis.** Reuse exactly the axis
  [`orientPlanet`](../../src/render/three/three-renderer.ts#L379) already
  computes — orbit-plane normal (`inclination`, `longitudeAscendingNode`) tilted
  by `obliquity` around `obliquityAzimuth` via `tiltNormal`. `RingGeometry` lies
  in its local XY plane (normal +Z), so rotate +Z → that spin axis. The ring
  then shares the planet's equatorial plane and moon-disk plane.
- **Position** = the planet's position; **radii** scale from the planet's drawn
  radius (`RenderableDef.radius`, already morphed by body-scale). Typical rings
  span ~1.2–2.3 planetary radii; exact inner/outer (and gap position) get a
  little per-planet variation from a data hash (`varietySeed`-style, no new RNG
  draw).
- Rigid, essentially static (rings orbit far too slowly to animate); no per-frame
  churn.

### 3.2 Appearance (kept deliberately simple — the only mild-risk part)

- A **radial** brightness/opacity profile: opaque-ish mid-band, softer at the
  inner and outer edges, with **one darker gap**. This is a 1-D function of
  radius — no 2-D noise, no domain warping, no time.
- Colour: a subtle icy tan / grey (low saturation — correct for rings and hard to
  make ugly). Optionally tinted slightly by the planet.
- Translucent (`transparent`, `DoubleSide`, depth-write off or careful) so the
  planet and stars read through it.
- Implementation options (decide at build): (a) a small **generated radial
  texture** (a `CanvasTexture` written with the exact profile — fully
  predictable, like the glow sprite), mapped across the ring width; or (b) a
  tiny **TSL** shader computing radius from position. Leaning (a): I control the
  exact pixels, so it's the most predictable/verifiable.
- **Lit vs unlit:** start simple — likely a flat translucent material (or lightly
  lit). Planet-shadow-on-rings and ring-shadow-on-planet are **out of scope**
  (that's eclipses, workstream J).

## 4. Data inputs (all already generated — no new fields, no new RNG draws)

| Field | Used for |
| ----- | -------- |
| `hasRings` (`PlanetPhysical`) | whether to draw a ring at all |
| `obliquity`, `obliquityAzimuth` + orbit `inclination`, `longitudeAscendingNode` | the ring plane (= planet equatorial plane), via the existing `tiltNormal` |
| `RenderableDef.radius` | ring inner/outer scale |
| `mass` + `equilibriumTemp` (hash) | small per-planet variation of radii / gap (no new draw) |

Universe stays byte-identical (purely visual).

## 5. Rendering integration

- A dedicated **ring-mesh pool** on the Three system-tier path, filled each frame
  for visible ringed planets, surplus hidden — mirroring the sphere / star-sphere
  pools. (Distinct from the existing **orbit**-ring line mesh, which draws
  orbital *paths* — different thing; name carefully, e.g. `planetRingPool`.)
- Drawn at the **system tier** for near planets only; far tiers untouched.
- Behind the `Renderer` seam; Canvas 2D backend unaffected. Picking is unchanged
  (rings are visual only; the planet sphere stays the pick target).

## 6. Invariants

- Visual only: no generation / sim / determinism impact; no new sampled fields or
  RNG draws.
- System tier, near planets only; bounded on-screen work (a few ringed planets).
- WebGL2-capability baseline; no WebGPU-only requirement.

## 7. Testing

- Static pipeline for the agent: `npm run build` + `npm test` + lint. Any pure
  helper (e.g. ring inner/outer radius + gap from planet radius + seed) gets a
  small unit test.
- **Browser verification is Pierre's** (per AGENTS.md): does the ring sit in the
  planet's equatorial plane, tilt with the axis, read as translucent with a gap,
  scale sensibly, and look tasteful (not ugly); WebGL2 == WebGPU; no perf hit.

## 8. Open questions (for Pierre)

- **Lit or flat rings?** Start flat/translucent (simplest), or lightly lit by the
  star from the first pass?
- **Gap count:** one clear gap (Saturn/Cassini cue), or a couple of finer ones?
- **Which planets:** honour `hasRings` as-is (gas ~50%, ice ~40%, rocky ~5%), or
  also gate by size/temperature so only substantial cool planets get them?

## 9. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-07 | Do rings before the surface slices? | **Yes** — rings are geometry + a simple 1-D look, which the agent can build reliably; surfaces need a visual loop we lack. |
| 2026-07-07 | Appearance ambition | **Deliberately simple/tasteful** (subtle icy tan, soft radial profile, one gap) — keep the floor high rather than chase a fancy ceiling. |
| 2026-07-07 | Ring plane | The planet's **equatorial plane** — reuse the exact spin axis `orientPlanet` computes, so ring + moon disk + axial tilt all agree. |
| 2026-07-07 | Shadows (planet↔ring) | **Out of scope** — that's eclipses (workstream J). |
