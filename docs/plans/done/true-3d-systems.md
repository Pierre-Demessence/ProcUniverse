# True 3D planetary systems (Stage 3 + 4)

Focused implementation plan for the true-3D pivot, driven by Pierre's priority:
**3D planetary systems — spherical bodies, axial rotation, and a tiltable /
orbitable camera.** Detailed companion to
[rendering-backend.md](../rendering-backend.md) §6 (going full 3D) and §10
(decisions); those stay the high-level design, this is the staged build.

> Status: **plan drafted, awaiting Pierre's confirmation.** No code yet.

## Scope & decisions (from Pierre, 2026-07-01)

- **Inclined orbits: yes, in scope** (per-system disk plane + small per-planet
  inclination). This shifts the universe (new deterministic draws) — accepted.
- **Camera control: left-drag = pan, right-drag = orbit/tilt, wheel = zoom.**
  Default view stays top-down; a **flatten** control snaps back.
- **System tier only, Three backend only.** Other tiers (star / galaxy /
  galaxy-field / universe) stay 2D top-down; the Canvas 2D backend is unchanged
  (it renders the x,y projection of any inclined orbit — a top-down view).
- **Deferred:** 3D for the galaxy/star tiers, distance-based LOD, moon-system
  fly-to. Sphere planet *textures/shaders* (Stage 4 surface detail) come after
  basic lit spheres.

## Sequencing rationale

Orbital inclination is only *visible* once a 3D camera + spheres exist (in 2D
top-down it collapses to the x,y projection). So build the camera + spheres
first (coplanar, no generation change — low risk, immediate visual payoff), then
add inclination (the universe-shifting generation/sim change) on top.

## Step 3D-A — 3D camera + sphere bodies + rotation (orbits coplanar)

Delivers the visible 3D (rotating spheres you can orbit/tilt around) with **no
generation change** — bodies stay at z=0; the camera provides the 3D view.

> Status (2026-07-01): **3D-A complete** — orbit/tilt camera + lit rotating
> spheres + 3D orbit rings + 3D-projected labels + raycast picking. Green on
> build + 222 tests + lint; peer-reviewed (no blockers). Awaiting Pierre's browser
> test. Orbits are still coplanar; **3D-B** (per-planet inclination + a Z
> coordinate) is next.

- [x] **Camera**: orbit state (azimuth, tilt, default gentle tilt) driven by
      **right-drag**; left-drag pans + wheel zooms unchanged; context menu
      suppressed; `resetOrbit()` wired into the reset-view button.
- [x] **Three camera**: a `PerspectiveCamera` from the focus, a distance derived
      from `zoom`, and azimuth/tilt — system tier only; other tiers keep ortho.
- [x] **Spheres**: pooled `SphereGeometry` — stars emissive, planets/moons lit,
      black hole a dark shaded sphere; an ambient + key light.
- [x] **Axial rotation**: planets spin from `rotationPeriod`, tilted by
      `obliquity`; stars a slow default spin (moons/BH static for now).
- [x] **Orbit rings in 3D**: all visible orbits merged into a single
      `LineSegments` in the z=0 orbit plane (one draw call + one buffer upload),
      rebuilt per frame, mirroring the 2D ellipse; tiny orbits culled.
- [x] **Labels in 3D**: body positions projected through the perspective camera
      onto the 2D overlay (moon labels gated by orbit width, as in 2D).
- [x] **Picking**: raycast against the visible spheres at the system tier; 2D
      `pickBodyAt` still used when the toggle is off.
- [x] Static pipeline + peer review; **Pierre browser A/B pending**.

### 3D-A follow-up fixes (2026-07-01, post browser test)

Pierre browser-tested 3D-A; the FPS regression and four reported issues were
addressed. Green on build + 222 tests + lint; peer-reviewed (LGTM).

- [x] **Perf: orbit-ring FPS regression.** The zoomed-in system view dropped to
      ~17 FPS. Root cause: each orbit ring was a separate `LineLoop` (its own
      per-frame buffer upload + draw call, `frustumCulled=false`), and the ring
      count scales with zoom-in — proven *not* fill-rate (RENDER_SCALE=0.05 gave
      identical FPS). Fix: merged all rings into one `LineSegments`. Back to 75 FPS.
- [x] **#3 Sun clipping + neighbour culling.** The perspective far plane was
      tied to the focus distance, so the central star was clipped when zoomed in
      on an outer planet. `render()` now sizes `far` to the *focused system's*
      reach (nearest-star distance + widest planet apoapsis) — enough to enclose
      the whole system incl. its star, yet tight enough that neighbouring systems
      (light-years off) and their labels are clipped rather than drawn behind it.
- [x] **#2 Reticle projection.** The selection reticle used the 2D `worldToView`,
      so it drifted after a pan in the 3D view. Now projected through the
      perspective camera via `projectToScreen` when the Three backend is active.
- [x] **#4 3D-aware pan.** Left-drag panned along the raw 2D axes, wrong once
      the view was orbited/tilted. Now maps the drag onto the z=0 ground plane
      (azimuth-rotated basis + tilt foreshortening) via a `panMode3D` flag set
      only at the 3D system tier.
- [x] **Materials.** Restored `MeshStandardMaterial` (PBR) for the spheres;
      `RENDER_ANTIALIAS` back on now the view is no longer fill-bound.
- [ ] **Deferred fidelity:** the emissive star reads flat (no limb darkening) —
      it *is* a sphere, but uniformly self-lit; a star shader is a later polish.

## Step 3D-B — inclined orbits + Z coordinate

Makes the orbits genuinely 3D: each system's disk gets a random 3D orientation
and each planet a small inclination, with a real Z coordinate driving the Three
view. **Confirmed decisions (Pierre, 2026-07-02):**

- **Disk orientation: full random 3D** (option A). Each system's disk normal is
  uniform on the sphere (`cos i = 1 − 2u`, `node = 2π·v`); planets scatter around
  it with a realistic mutual inclination (see Data realism). Most realistic; the
  default 2D view will show inclined / edge-on systems, so the 2D orbit rings are
  updated to project the inclined ellipse (bodies stay on their rings).
- **Determinism: second-pass append.** Each system's `srng` is a local generator,
  discarded once the system is built, so drawing the inclination values in a
  second loop *after* the planet loop perturbs nothing: the existing universe
  keeps every star / planet / moon / position byte-identical and only **gains
  tilt** — no universe shift at all.
- **Z storage: a parallel app-level `PositionZDef {z}` component.** `updateOrbits`
  writes x,y → `PositionDef` and z → `PositionZDef`. The 2D renderer / HUD / 2D
  picking keep reading `PositionDef` x,y (= the correct top-down projection); the
  Three path + labels + reticle read `PositionZDef`. Extending the engine
  `PositionDef` (shared, 2D) is rejected — it ripples through the Canvas 2D
  renderer + spatial modules.
- **Moons: equatorial plane (M2).** Regular (close-in) moons ride in the planet's
  **equatorial** plane — the orbital plane tilted by the planet's obliquity — so
  Saturn / Uranus-like systems read correctly. This adds one appended draw per
  planet (the spin-axis azimuth; the obliquity magnitude already exists) and ties
  the moon disk to the planet's axial tilt: the Three sphere's tilt becomes
  orbit-relative and shares the same spin axis, so a tilted planet and its moons
  visibly agree. No new moon-rng draws (moon count / physical byte-identical; each
  moon's world plane is baked in the second pass). **Inspector** shows the
  world-frame inclination (°). **Default renderer** stays `canvas2d` (evaluate
  switching after seeing it).

> Status (2026-07-02): **3D-B implemented** — inclined orbits + Z coordinate, full
> random per-system disk orientation, e-coupled + multiplicity mutual inclination,
> isotropic obliquity, equatorial-plane moons, and the Three sphere spin-axis
> re-orientation. Green on build + 232 tests + lint; peer-reviewed (LGTM). Pierre
> browser A/B pending.

### Orbit math

Elements gain `inclination` (i), `longitudeAscendingNode` (Ω) and `cz` (focus z).
`writeOrbitPosition` extends the perifocal → world transform to 3D: perifocal
`(xₚ, yₚ)` → `R_z(ω)` (today's argPeriapsis) → `R_x(i)` → `R_z(Ω)` → translate by
the focus `(cx, cy, cz)`; `out` becomes `{x, y, z}`. `i = 0` reproduces today's
coplanar result exactly. Moons: the focus is the parent's live 3D position
(`cx/cy/cz` set in `updateOrbits` pass 2 from the parent's `PositionDef` +
`PositionZDef`).

**Spin axis / equatorial plane (M2):** a planet's spin axis is its orbital-plane
normal tilted by its obliquity ε around a drawn azimuth φ. Its regular moons ride
in the perpendicular (equatorial) plane, so the generation second pass bakes each
moon's world `i`/`Ω` to that plane. The Three renderer orients the planet sphere's
pole along the same axis (and spins around it), replacing today's fixed world-X
tilt so the sphere and its moon disk agree.

### Data realism model (confirmed refinements, Pierre 2026-07-02)

- **Mutual inclination ↔ eccentricity equipartition (#1).** Each planet's tilt
  from the system's invariable plane is Rayleigh-distributed with
  `σ_i[rad] = INCLINATION_ECC_RATIO · e · m`, so dynamically hot planets are both
  eccentric and inclined (Xie et al. 2016). `e` is already on `PlanetData`;
  `INCLINATION_ECC_RATIO ≈ 0.5`. Draw: `i = σ_i·√(−2·ln(1−u))` (magnitude) + a
  uniform node azimuth relative to the disk.
- **Multiplicity dependence — Kepler dichotomy (#3).** `m` shrinks with planet
  count: `m = lerp(INCLINATION_MULT_HOT, INCLINATION_MULT_COLD, t)`,
  `t = (planetCount − PLANET_MIN)/(PLANET_MAX − PLANET_MIN)`, HOT ≈ 2.5 (few
  planets, dynamically hotter) → COLD ≈ 1.0 (many planets, flat).
- **Isotropic obliquity (#2).** `samplePlanet`'s `obliquity = rng()·180` becomes an
  isotropic draw `acos(1 − 2·rng())` (uniform in cosθ, more weight near 90°;
  captures Venus 177° / Uranus 98°). Same single draw remapped → planets stay
  byte-identical except their obliquity values (which now also drive moon/spin
  planes).
- Moons are baked exactly in the equatorial plane (no per-moon scatter); the
  eccentricity distribution (`e = u²·ECC_MAX`) is unchanged — inclination inherits
  its realism through the coupling above.

### Tasks

- [x] **orbits.ts (foundation).** `OrbitElements` + `OrbitElementsDef` gain `cz`,
      `inclination`, `longitudeAscendingNode` (alphabetical: a, argPeriapsis, cx,
      cy, cz, e, inclination, longitudeAscendingNode, meanAnomaly0, parent,
      starMass). `writeOrbitPosition` → 3D (`out {x, y, z}`). New `PositionZDef
      {z}`. `updateOrbits` 2-pass writes z; the moon pass sets `cx/cy/cz` from the
      parent's full 3D position. `drawOrbitRings` (2D) samples the 3D ellipse and
      projects to x,y.
- [x] **planets.ts (obliquity #2).** `samplePlanet`'s `obliquity = rng()·180` →
      isotropic `Math.acos(1 − 2·rng()) · 180/π` (same draw, remapped). Add
      `obliquityAzimuth` to `PlanetPhysical` + `PlanetPhysicalDef`, returned as 0
      (no draw; universe.ts overwrites it in the second pass).
- [x] **universe.ts (generation).** After the planet loop, a second pass draws the
      disk orientation (2 draws) + per-planet inclination (Rayleigh, e-coupled ×
      multiplicity — see Data realism) + node azimuth + spin-axis azimuth φ
      (≈3 draws each). Computes each planet's world `i`/`Ω` and equatorial plane,
      sets `PlanetPhysical.obliquityAzimuth = φ`, and bakes each moon's world
      `i`/`Ω` to that equatorial plane. `PlanetData` gains `inclination` +
      `longitudeAscendingNode`. New knobs (config/data.ts): `INCLINATION_ECC_RATIO`,
      `INCLINATION_MULT_HOT`, `INCLINATION_MULT_COLD`.
- [x] **moons.ts.** `MoonData` gains `inclination` + `longitudeAscendingNode`
      (placeholder 0 in `generateMoons`; the universe.ts second pass bakes the
      equatorial plane). No `generateMoons` signature change, no new draws.
- [x] **spawn.ts + main.ts.** Set the new orbit fields (planet `cz = 0` + i/Ω;
      moon i/Ω); register `PositionZDef`.
- [x] **three-renderer.ts + draw-labels.ts + main.ts.** `render()` reads z from
      `PositionZDef` and orients each planet sphere's pole along its spin axis
      (orbital normal tilted by obliquity ε around azimuth φ), spinning around it
      (replaces the fixed world-X tilt); `updateOrbitRings` samples the full 3D
      ellipse per segment (planet + equatorial moon rings); `drawBodyLabels3D` +
      the selection reticle pass the real z.
- [x] **inspector.tsx.** `PlanetPanel` gains an "Inclination" row (°, advanced).
- [x] **Tests + docs.** Update every `OrbitElements` literal (+`cz`, +i, +Ω) in
      orbits.test.ts / focus.test.ts / pick.test.ts and the `PlanetPhysical`
      literal (+`obliquityAzimuth`); add 3D-projection tests (nonzero i → nonzero
      z + foreshortened top-down radius; Ω rotates the node; i = 0 == coplanar;
      moon glued to a tilted moving parent); register `PositionZDef` in the
      updateOrbits test. Data-realism tests: mutual inclination grows with `e`
      (equipartition) and shrinks with planet count (dichotomy); obliquity spans
      past 90° (isotropic); moons coplanar with their planet's equatorial plane.
- [x] Static pipeline (`npm run build`, `npm test`, `npm run lint`) + peer review
      (fast model) + Pierre browser A/B.

## Invariants (do not regress)

- **Determinism**: inclination draws appended at the end of sampling; universe
  stays a pure function of the seed.
- **Floating origin / precision**: the 3D camera + positions use
  render-origin-relative coordinates, as today.
- **Canvas 2D backend**: still renders the top-down x,y projection (no 3D
  camera); `drawOrbitRings` is updated to project the inclined ellipse so bodies
  stay on their rings.
- **HUD**: DOM panels stay DOM; body labels track their 3D positions.

## Open decisions (resolve as steps start)

- Z storage: **resolved** — a new app-level `PositionZDef {z}` component (3D-B).
- Light model: single directional light vs. a light at the star.
- Labels: 3D-projected onto the 2D overlay vs. world-space text in the scene.
