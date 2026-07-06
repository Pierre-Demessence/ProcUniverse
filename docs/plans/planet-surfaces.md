# Planet Surface Overhaul — staged plan

The planet half of the system-visuals roadmap
([system-visuals.md](system-visuals.md)). Stars now read as real spheres
([star-shading.md](done/star-shading.md)); planets are still flat single-colour
balls (correctly lit by the star, but blank). This plan turns them into
recognisable worlds — banded gas giants, mottled rocky surfaces with ice caps
and oceans, atmospheres, rings — **one shippable slice at a time**, entirely
from the already-generated physical data.

Covers workstreams **D, E, F, G, H, I** of
[system-visuals.md](system-visuals.md); part of **Stage 2 (shader effects, R2)**
and **Stage 4 (sphere surfaces, R3)** of
[rendering-backend.md](rendering-backend.md), **system tier only**.

> Status: **planned, ready to build.** Nothing implemented yet. Sequencing and
> the key design calls are settled (see §10); Phase 1 (gas/ice giants) is the
> next slice. Only the Phase 3 cloud-layer mechanism is deferred until reached.

## 1. Strategy: split, gas giants first

Not one big change. Following the star-shading rhythm, each **kind of world** is
a self-contained slice that builds, tests, reviews, and browser-verifies on its
own. Recommended order (priority mirrors the roadmap):

1. **Gas / ice giants** (workstream D) — biggest visual jump, simplest shader
   (horizontal bands + temperature colour ramp), and it establishes the shared
   **lit planet-material** infrastructure every later slice reuses.
2. **Rocky / terrestrial** (workstream E) — mottled surface, temperature colour
   ramp (molten → rock → ice), polar caps, oceans for liquid-water worlds.
3. **Atmospheres** (workstream F) — rim-glow halo + a thin drifting cloud layer
   on worlds that keep an atmosphere.
4. **Rings** (workstream G) — a translucent tilted ring disc. Independent of the
   surface shaders (it's geometry, not a fragment shader) and high payoff; could
   be pulled earlier if desired (see §8).
5. **Oblateness** (workstream H) — squash fast rotators at the equator. A cheap
   geometry tweak; can piggyback on any slice.
6. **Moon surfaces** (workstream I) — small grey/icy cratered bodies so moons
   don't read as mini-planets. A trim of the rocky shader.

Eclipses / cast shadows (workstream J) stay out of scope — roadmap-optional.

## 2. Key difference from the star shader (the one architectural call)

Stars use a **self-lit** material (`MeshBasicNodeMaterial`): they make their own
light and ignore the scene lighting. **Planets must stay lit** — the star's
point light already paints their day side and a day/night terminator, and that
must keep working. So a planet slice replaces only the planet's **albedo
(surface colour/pattern)**, not its lighting model:

- Planets keep a **lit node material** (`MeshStandardNodeMaterial`), so the
  existing star `PointLight` + ambient still shade them.
- We drive its **`colorNode`** (albedo) with a procedural TSL surface, instead
  of today's flat `material.color.set(fill)`
  ([three-renderer.ts](../../src/render/three/three-renderer.ts#L481)).

This keeps the terminator, orbit-tracking lit face, and eclipse-readiness for
free, and means "prettier planets" is purely a surface-colour change.

## 3. Shared infrastructure (built in Phase 1, reused after)

- **`src/render/three/planet-material.ts`** — `createPlanetMaterial()` returning
  a handle `{ material, setPlanet(...), setTime(seconds), dispose() }`, mirroring
  [star-material.ts](../../src/render/three/star-material.ts). One handle per
  planet mesh via a **`planetSpherePool`** analogous to `starSpherePool`
  ([three-renderer.ts](../../src/render/three/three-renderer.ts#L173)) (a system
  holds only a handful of planets, so per-planet handles are cheap).
- **`src/render/three/planet-surface.ts`** — pure, unit-testable helpers mapping
  physical data → shader parameters (band colours, ramp stops, cloud/cap
  thresholds), mirroring [star-surface.ts](../../src/render/three/star-surface.ts).
  The shader itself has no tests; these helpers do (per §6).
- The renderer's planet loop stops calling flat `place(...)` for planets and
  instead obtains a pooled planet-material mesh, sets its data + wall-clock time,
  and orients it via the existing `orientPlanet`.

## 4. Determinism & data (invariant: universe byte-identical)

Every look is derived from existing `PlanetPhysical` fields + orbit data — **no
new sampled fields, no new RNG draws**, exactly like star-shading. Where a look
needs per-planet variety (so two Jupiters differ), the noise offset is derived
from data already on the entity (e.g. a hash of the planet's `name`, or its
physical values) — never a new `rng()` draw. If a future slice genuinely needs a
*new* sampled field, it is appended to the body's draw order per the realism
plans' convention; the aim is to avoid that entirely.

Fields available today (from [planets.ts](../../src/generation/planets.ts)):
`type`, `equilibriumTemp`, `waterState`, `inHabitableZone`, `insolation`,
`mass`, `radius`, `density`, `obliquity`, `obliquityAzimuth`, `rotationPeriod`,
`hasRings`, plus derived `retainsAtmosphere` / `atmosphereType` /
`surfaceTemperature`.

## 5. Phase 1 — Gas / ice giant surfaces (the actionable slice)

Replace the flat fill on gas-giant and ice-giant planets with a banded
procedural surface.

### 5.1 Feature checklist

- [ ] **Lit planet material infra.** `planet-material.ts` + `planet-surface.ts`
      + `planetSpherePool`, wired into the renderer's planet loop (§3). Rocky /
      moon / black-hole planets keep the current flat material until their slice.
- [ ] **Horizontal bands.** Stripes across latitude (`positionLocal.y` on the
      oriented sphere) — a banded value from a low-frequency function of
      latitude, warped by turbulence noise for the swirled, non-straight edges.
- [ ] **Temperature colour ramp.** Warm giants (Jupiter-like) → creams / tans /
      browns; cold giants and ice giants → cyans / deep blues. Ramp stops chosen
      from `type` + `equilibriumTemp`.
- [ ] **Per-planet variety.** A noise offset derived from existing entity data
      (no new draw) so two same-type giants look different.
- [ ] **Stays lit.** The star point light still produces a day/night terminator
      across the bands (verify the lit node material path). No self-illumination.
- [ ] **Animated bands (wind / storms).** Real gas giants have fast, turbulent
      atmospheres, so the bands drift and the turbulence swirls over time
      (wall-clock; §5.3). This is a realism cue, not decoration — kept plausible,
      not frantic. Adjacent bands can drift at different rates (zonal winds).

### 5.2 Data inputs

| Field (`PlanetPhysical`) | Used for |
| ------------------------ | -------- |
| `type` (`gas-giant` / `ice-giant`) | band palette family |
| `equilibriumTemp` (K) | warm↔cold colour ramp |
| `insolation` (S⊕) | optional brightness/haze bias |
| entity `name` (or physical values) | per-planet noise offset (no new draw) |

### 5.3 Technical notes

- Author in **TSL** → runs on WebGPU and the WebGL2 fallback from one source
  (same as the star shader).
- Use `MeshStandardNodeMaterial` (lit) with a procedural `colorNode`; leave
  `metalness`/`roughness` giant-appropriate.
- Band drift uses **wall-clock** time, not `simSeconds` — matches the
  star-shading decision (no freeze-when-paused / strobe-under-time-warp); the
  motion is cosmetic so wall-clock has no realism cost.
- No runtime toggle: procedural surfaces are always-on realism (toggles are for
  quality-of-life / user-choice rendering only). Tuning stays in `config/render`
  knobs, adjusted in-browser — same as star-shading.
- Bounded on-screen work: only near system-tier planets get the shader; far
  tiers (points/sprites/glow) are untouched.

## 6. Phases 2–6 (sketch — expanded when reached)

- **Phase 2 — Rocky / terrestrial.** Mottled cratered surface; colour ramp
  molten-red → brown/grey → ice-white by `equilibriumTemp` / `surfaceTemperature`;
  polar ice caps by latitude + temperature; blue oceans where `waterState` is
  liquid / `inHabitableZone`.
- **Phase 3 — Atmospheres.** Soft coloured rim glow ("airglow") on worlds with
  `retainsAtmosphere`, tinted by `atmosphereType`; a thin drifting cloud layer
  over them (a second, slightly larger translucent sphere or a shader layer).
- **Phase 4 — Rings.** A translucent ring disc for `hasRings` planets, tilted to
  the planet's equatorial plane (the same normal `orientPlanet` uses). Data
  exists; rings are not drawn today — high payoff, independent geometry.
- **Phase 5 — Oblateness.** Squash the sphere at the equator using the existing
  `oblateness(...)` value — a per-axis scale on the mesh; subtle.
- **Phase 6 — Moon surfaces.** A trimmed rocky shader (grey/icy cratered, no
  atmosphere/oceans) so moons read as small bodies.

## 7. Invariants

- Visual only: no generation / sim / determinism impact; no new sampled fields
  or RNG draws (see §4).
- Effects apply at the **system tier** to near planets; far tiers unchanged.
- Behind the `Renderer` seam; the Canvas 2D backend is untouched; all work lives
  on the Three.js path.
- WebGL2-capability baseline via TSL; any WebGPU-only trick is a progressive
  enhancement, never required.
- Bounded on-screen work (a handful of planets per system).

## 8. Open questions

- **Cloud layer (Phase 3).** Separate translucent sphere mesh, or a shader layer
  on the surface material? Decided when we reach Phase 3.

(Sequencing, the toggle question, and band animation are settled — see §10.)

## 9. Testing

- Static pipeline only for the agent: `npm run build` (tsc + vite) + `npm test`
  - lint. Shaders have no unit tests; the pure `planet-surface.ts` helpers
  (data → shader params) get small tests, mirroring `star-surface.test.ts`.
- **Browser verification is Pierre's** (per AGENTS.md): do giants read as banded
  worlds, is the day/night terminator correct across the bands, does the WebGL2
  fallback match WebGPU, no perf regression.

## 10. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-06 | Scope | Planet **surfaces**, system tier only; all looks derived from existing physical data. |
| 2026-07-06 | All-in-one vs split | **Split** — one shippable slice per kind of world, like star-shading. |
| 2026-07-06 | First slice | **Gas / ice giants** — biggest jump, simplest shader, builds the shared lit-planet material infra. |
| 2026-07-06 | Lighting model | Planets stay **lit** (`MeshStandardNodeMaterial`); we replace only the albedo (`colorNode`). Star point light keeps the terminator. |
| 2026-07-06 | Sequencing | Gas/ice giants → rocky → atmospheres → rings → oblateness → moons (rings stay at 4, not pulled forward). |
| 2026-07-06 | Runtime toggle | **None.** Procedural surfaces are always-on realism; toggles are reserved for quality-of-life / user-choice rendering. Tune via `config/render` knobs. |
| 2026-07-06 | Giant band animation | **Animated** — real gas giants are windy/stormy; bands drift + turbulence swirls (wall-clock, plausible not frantic). |
