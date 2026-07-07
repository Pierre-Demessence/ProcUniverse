# Planet Rings — a slice of the planet-surface overhaul

Workstream **G** of [system-visuals.md](system-visuals.md) and
[planet-surfaces.md](planet-surfaces.md). A translucent, tilted ring disc around
planets that have rings — **geometry first, appearance deliberately simple**.

> Status: **iteration 1 committed** (`0df17ce`); **iteration 2 in progress** —
> lit rings + planet-shadow band + colour-by-temperature. See the iteration
> roadmap (§10). Knobs live in `planet-rings.ts`.

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

## 8. Open questions

Iteration-1 questions are resolved (see §9). Open for later iterations:

- **Shadow model:** the iteration-2 planet-shadow band uses a cheap cylindrical
  approximation (parallel star rays). Upgrade to a proper cone / penumbra later
  if wanted.
- **Ring-particle scattering:** add forward/back-scatter (backlit rings glow)
  as a later polish pass.

## 9. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-07 | Do rings before the surface slices? | **Yes** — rings are geometry + a simple 1-D look, which the agent can build reliably; surfaces need a visual loop we lack. |
| 2026-07-07 | Appearance ambition | **Deliberately simple/tasteful** (subtle icy tan, soft radial profile, one gap) — keep the floor high rather than chase a fancy ceiling. |
| 2026-07-07 | Ring plane | The planet's **equatorial plane** — reuse the exact spin axis `orientPlanet` computes, so ring + moon disk + axial tilt all agree. |
| 2026-07-07 | Iteration 1 shadows | Out of scope for iteration 1 (flat translucent, one gap, honour `hasRings`). **Committed `0df17ce`.** |
| 2026-07-07 | Iteration 2 scope | **Lit rings + planet-shadow band + colour-by-temperature** — all geometric / data-driven (safe to build). Diversity + fresnel + backlit follow (§10). |

## 10. Iteration roadmap (upgrades)

All upgrades stay **geometric / data-driven** (not blind aesthetic tuning), so
each is buildable and verifiable. Grouped by theme:

### Iteration 1 — baseline (done, committed `0df17ce`)

Flat translucent ring, one gap, subtle icy tan, honour `hasRings`.

### Iteration 2 — lighting + identity (in progress)

- [ ] **Lit rings.** The ring is star-lit (near-uniform bright, since ring
      particles scatter light from any angle) rather than a flat constant fill.
- [ ] **Planet-shadow band.** The dark band where the planet's shadow crosses
      its rings — *the* iconic Saturn cue. Cheap cylindrical approximation:
      a ring fragment is shadowed when it lies behind the planet (away from the
      star) within the planet's radius of the shadow axis.
- [ ] **Colour by temperature/composition.** Icy white/blue rings for cold
      planets; dusty tan / brown / reddish for warmer or rocky ones — from
      `equilibriumTemp` (+ `type`). Gives each ringed planet its own identity.

### Iteration 3+ — diversity & polish (later)

- **Varied gap structure** — gap count / positions / widths per planet from the
  variety hash (Saturn has several: Cassini, Encke), not one fixed gap.
- **Width / opacity / inner-radius variation** — broad-bright vs thin-faint rings
  per planet from the hash.
- **Static radial ringlets** — subtle radius-only (no-time) noise for fine
  ringlet structure; safe from the grain problem because it never uses time.
- **Edge-on transparency (Fresnel)** — rings nearly vanish edge-on and brighten
  face-on, like real Saturn (view-angle-dependent opacity).
- **Backlit glow / scattering** — rings brighter when backlit by the star.
