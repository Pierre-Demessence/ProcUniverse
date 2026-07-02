# True 3D planetary systems (Stage 3 + 4)

Focused implementation plan for the true-3D pivot, driven by Pierre's priority:
**3D planetary systems — spherical bodies, axial rotation, and a tiltable /
orbitable camera.** Detailed companion to
[rendering-backend.md](rendering-backend.md) §6 (going full 3D) and §10
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

Makes the orbits genuinely 3D. Universe-shifting (accepted).

- [ ] **Orbit elements**: add `inclination` + `longitudeAscendingNode` to
      `OrbitElementsDef`.
- [ ] **Generation**: per-system disk-plane orientation + small per-planet
      inclination in `universe.ts`, as deterministic draws **appended** at the
      end of a body's sampling (so existing draws are unperturbed in order).
- [ ] **Z coordinate**: decide storage (parallel Z component vs. extend) — the
      2D renderer/HUD keep using x,y (top-down projection); the Three 3D path
      reads x,y,z. `updateOrbits` / `writeOrbitPosition` compute the 3D position
      by projecting the ellipse into the tilted plane.
- [ ] **Inspector**: show inclination.
- [ ] Static pipeline + peer review + Pierre browser A/B.

## Invariants (do not regress)

- **Determinism**: inclination draws appended at the end of sampling; universe
  stays a pure function of the seed.
- **Floating origin / precision**: the 3D camera + positions use
  render-origin-relative coordinates, as today.
- **Canvas 2D backend unaffected**: it renders the x,y projection; no 3D camera.
- **HUD**: DOM panels stay DOM; body labels track their 3D positions.

## Open decisions (resolve as steps start)

- Z storage: a new app-level `PositionZDef {z}` component vs. another approach.
- Light model: single directional light vs. a light at the star.
- Labels: 3D-projected onto the 2D overlay vs. world-space text in the scene.
