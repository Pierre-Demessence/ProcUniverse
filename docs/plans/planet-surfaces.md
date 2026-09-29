# Planet Surface Overhaul — staged plan

The planet half of the system-visuals roadmap
([system-visuals.md](system-visuals.md)). Stars read as real spheres
([star-shading.md](done/star-shading.md)); rings
([planet-rings.md](done/planet-rings.md)) and oblateness (H) have shipped.
Planets are still flat single-colour balls (correctly lit by the star, but
blank). This plan turns them into recognisable worlds — atmospheres, rocky
surfaces with ice caps and oceans, moons, banded gas and ice giants — **one
shippable slice at a time**, entirely from the already-generated physical data.

Covers workstreams **D, E, F, I** of [system-visuals.md](system-visuals.md);
part of **Stage 2 (shader effects, R2)** and **Stage 4 (sphere surfaces, R3)**
of [rendering-backend.md](rendering-backend.md), **system tier only**. Tracked
in [roadmap.md](../roadmap.md).

## 1. Why the first attempt stalled, and what changes

Two gas-giant shader attempts were reverted as "ugly / not gaseous / noisy /
degenerates into grains." The findings are captured in
[gas-giant-shading.md](../research/gas-giant-shading.md) and stay the technical
reference for Phase 5. The root cause was **process, not technique**: surface
looks are judged by taste, and each iteration was an agent code change followed
by a full in-app browser check. That loop is too slow and too blind to converge.

This plan changes three things:

1. **A tuning tool comes first** (Phase 0, the *planet lab*): every look
   parameter is a live slider, so Pierre tunes by eye in seconds and hands back
   the values; the agent bakes them into `config/render` defaults.
2. **Easiest-to-get-right slices first.** Atmosphere rim glow and rocky
   surfaces are forgiving (an imperfect rocky world still reads as "a plausible
   alien world"); a convincing gas giant is the hardest look in the plan
   (fluid, banded, storm detail — imperfect reads as "striped ball" or "noise").
   Gas giants move to the end, once the infrastructure and the tuning workflow
   are proven.
3. **Still before moving.** Animation caused the worst artefact
   (precision-loss grain) and doubled the tuning surface. Every look ships
   static first; band motion is a separate, final, optional slice.

## 2. Phases (in order)

| Phase | Slice | Workstream | Risk |
| ----- | ----- | ---------- | ---- |
| 0 | Planet lab + shared planet material | infra | low |
| 1 | Atmosphere rim glow | F (part) | low |
| 2 | Rocky / terrestrial surfaces | E | medium |
| 3 | Moon surfaces | I | low (trim of 2) |
| 4 | Cloud layer on atmospheric worlds | F (part) | medium |
| 5 | Gas / ice giants — static | D | high |
| 6 | Gas giant band motion (optional) | D | medium |

Each phase is a self-contained slice that builds, tests, reviews, and is
browser-verified by Pierre on its own. Eclipses / cast shadows (workstream J)
stay out of scope — roadmap-optional.

## 3. Architecture

### 3.1 Lit material, albedo only

Stars use a **self-lit** material (`MeshBasicNodeMaterial`). **Planets stay
lit**: the star's point light already paints their day side and the day/night
terminator, and that must keep working. A planet slice replaces only the
planet's **albedo** (surface colour/pattern), not its lighting model:

- Planets use a **lit node material** (`MeshStandardNodeMaterial`), so the star
  `PointLight` + ambient still shade them.
- Its **`colorNode`** (albedo) is driven by the surface, instead of today's flat
  `material.color.set(fill)` in
  [three-renderer.ts](../../src/render/three/three-renderer.ts).
- **Exception — thermal glow.** The hottest worlds (molten rocky planets, hot
  Jupiters) glow on their own. This is an additive **`emissiveNode`** on top of
  the lit albedo, not a switch to a self-lit material; the terminator still
  shows, the night side glows faintly.

### 3.2 Baked surface maps vs per-pixel procedural (decided in Phase 0)

Two ways to produce the albedo:

- **Per-pixel procedural** — evaluate the noise in the fragment shader every
  frame (the approach of the reverted attempts).
- **Baked map** — generate an equirectangular albedo map (e.g. 1024×512) **once
  per planet** when it first becomes visible (GPU render-to-texture or CPU), with
  mipmaps, and sample it on the sphere. Regenerated only when the planet or its
  tuning changes.

Baked maps are the **recommended default**:

- **No shimmer when small.** Planets are often only tens of pixels wide.
  Per-pixel noise with fine detail aliases and sparkles at that size (a likely
  contributor to the "noisy" verdict); mipmapped textures filter it away for
  free.
- **Debuggable.** The flat map can be shown directly in the lab.
- **Affordable quality.** More octaves / warping cost nothing per frame.
- **Cost:** a texture per visible planet (a handful per system; evict on system
  change), a one-time bake per planet, and motion (Phase 6) needs a
  per-pixel layer on top or a UV scroll rather than re-baking.

Optional hybrid for gas giants (Phase 5, decided there): a few **greyscale
structure maps** (band/storm structure derived from real imagery with a
compatible licence, e.g. CC BY — licence checked before use) recoloured from
the planet's data. Trades "fully procedural" purity for a look that reads
correctly immediately. Only adopted if the procedural bake does not reach the
bar in the lab.

### 3.3 Screen-size awareness

Detail must fade with on-screen size. Below a few tens of pixels a planet shows
its average colour + rim glow only; full detail appears only when it is large.
With baked maps this is mostly mip selection; any per-pixel layer (clouds,
motion) needs an explicit size-based fade.

### 3.4 Shared modules

- **`src/render/three/planet-material.ts`** — `createPlanetMaterial()`
  returning a handle `{ material, setPlanet(...), setTime(seconds), dispose() }`,
  mirroring [star-material.ts](../../src/render/three/star-material.ts). One
  handle per planet mesh via a **`planetSpherePool`** analogous to
  `starSpherePool` (a system holds only a handful of planets).
- **`src/render/three/planet-surface.ts`** — pure, unit-testable helpers
  mapping physical data → surface parameters (regime selection, palette stops,
  cap/ocean thresholds, band count), mirroring
  [star-surface.ts](../../src/render/three/star-surface.ts). Shaders have no
  tests; these helpers do.
- **Surface parameter set** — one typed object per look (e.g.
  `RockySurfaceParams`, `GiantSurfaceParams`) whose defaults live in
  `config/render`. The renderer and the lab both consume the same type, so a
  value tuned in the lab is pasted verbatim into config.
- The renderer's planet loop obtains a pooled planet-material mesh, sets its
  data (+ wall-clock time where animated), and orients it via the existing
  `orientPlanet`. Planet types without a shipped slice keep the flat albedo.

## 4. Determinism & data (invariant: universe byte-identical)

Every look is derived from existing `PlanetPhysical` fields + orbit data — **no
new sampled fields, no new RNG draws**, exactly like star-shading. Per-planet
variety (so two Jupiters differ) comes from a hash of data already on the
entity (e.g. `name`, or mass + temperature) — never a new `rng()` draw.

Fields available (from [planets.ts](../../src/generation/planets.ts)): `type`,
`equilibriumTemp`, `waterState`, `inHabitableZone`, `insolation`, `mass`,
`radius`, `density`, `obliquity`, `obliquityAzimuth`, `rotationPeriod`,
`hasRings`, plus derived `retainsAtmosphere` / `atmosphereType` /
`surfaceTemperature`.

## 5. Phase 0 — Planet lab + shared material

A dev-only page for tuning looks by eye, plus the shared infrastructure every
later phase reuses.

### 5.1 Checklist

- [ ] **Lab entry point.** Dev-only (e.g. a separate Vite HTML entry or a
      `?lab=planet` URL flag), excluded from the production build or unreachable
      from the UI. Renders **one planet large**, lit by a single point light
      that can be orbited around it (to check the terminator), on a dark
      background.
- [ ] **Planet picker.** Choose a real generated planet (seed + planet) or a
      synthetic one (type, temperature, rotation period, water state sliders),
      so looks are tuned against the data they will actually receive.
- [ ] **Live sliders** for every parameter of the active surface type, driving
      the same parameter object the renderer uses. Slider UI via a small
      standard library (`lil-gui`, the de-facto three.js tuning panel) as a dev
      dependency, or a minimal Preact panel if a dependency is unwanted.
- [ ] **Export / import.** A "copy parameters" button that yields the exact
      object to paste into `config/render`, and a paste-to-load for sharing
      values between Pierre and the agent.
- [ ] **Size preview.** A toggle to render the planet at typical in-app sizes
      (e.g. 16 / 48 / 150 px wide) to judge shimmer and detail fade.
- [ ] **Map view.** Show the baked equirectangular map flat beside the sphere.
- [ ] **Reference strip.** Space for reference images (Pierre supplies/links
      them; nothing copyrighted is committed).
- [ ] **Shared material infra** (§3.4): `planet-material.ts`,
      `planet-surface.ts`, `planetSpherePool`, wired into the renderer with the
      current flat colour as the only "surface" — no visual change in-app.
- [ ] **Decide §3.2** (baked vs per-pixel) using the lab: a quick noise test
      at small sizes on both paths. Record the decision in §12.

## 6. Phase 1 — Atmosphere rim glow

The highest value-to-risk slice: a thin, soft coloured halo at the limb makes a
ball read as a world.

- [ ] Rim glow on worlds with `retainsAtmosphere` (and on gas/ice giants,
      whose whole visible surface is atmosphere), tinted by `atmosphereType`
      (e.g. Earth-like → pale blue, CO₂-thick → hazy yellow-white, methane →
      cyan).
- [ ] Glow strength follows the lit side — bright at the sunlit limb, fading
      into the night side (a faint twilight wrap past the terminator), so it
      never looks like a uniform neon outline.
- [ ] Thickness/intensity scale plausibly with atmosphere type; airless worlds
      get none.
- [ ] Implementation (Fresnel term on the planet material vs a slightly larger
      back-faced shell mesh) chosen in the lab by look.
- [ ] Parameters tuned by Pierre in the lab; defaults in `config/render`.

## 7. Phase 2 — Rocky / terrestrial surfaces

- [ ] Mottled surface from smooth, low-octave noise (continents / terrain
      patches), no high-frequency grain.
- [ ] Temperature colour regime from `surfaceTemperature` /
      `equilibriumTemp`: molten (dark crust + glowing red cracks via
      `emissiveNode`, §3.1) → barren rock (browns / greys / rusts) → frozen
      (ice-white / pale grey).
- [ ] Oceans where `waterState` is liquid: a sea level on the same noise, deep
      blue below, land above.
- [ ] Polar ice caps by latitude + temperature (larger when colder; none when
      hot).
- [ ] Per-planet variety from the entity hash (§4).
- [ ] Tuned in the lab against real generated planets of each regime.

## 8. Later phases (sketch — expanded when reached)

- **Phase 3 — Moon surfaces.** The rocky surface trimmed to grey/icy airless
  bodies: craters / maria-like dark patches, no oceans or atmosphere, so moons
  read as small bodies rather than mini-planets.
- **Phase 4 — Cloud layer.** Thin, slow cloud cover on atmospheric worlds
  (separate translucent shell mesh vs a layer in the surface material — decided
  when reached, in the lab). Static first, like everything else.
- **Phase 5 — Gas / ice giants, static.** Follow the recipe in
  [gas-giant-shading.md](../research/gas-giant-shading.md) §4, minus motion:
  - Multi-stop **latitude palette** (not a two-colour sine), belts/zones as a
    gentle oscillation over it; band count from `rotationPeriod`.
  - **Temperature regimes** from `equilibriumTemp`: hot (dark, near-featureless,
    thermal `emissiveNode` glow for the hottest) → warm (Jupiter creams / tans /
    rusts) → cold (pale, hazy, blue-grey). Ice giants are their own smooth,
    blue, low-contrast regime (Neptune-like → Uranus-like).
  - **Gentle domain warp** only on band edges and detail; low-octave smooth
    fBM; no grain.
  - 0–2 **latitude-locked oval storms**; muted poles; subtle limb darkening.
  - Tuned in the lab against reference imagery. If the procedural bake does not
    reach the bar, evaluate the greyscale structure-map hybrid (§3.2).
- **Phase 6 — Gas giant band motion (optional).** Only once Phase 5 is
  accepted. Longitude-only zonal drift with alternating per-band rates;
  **bounded** time inputs only (periodic rotation / `sin`/`cos`, never
  `p + time·dir`) to avoid precision grain. Timebase (wall-clock vs sim time)
  decided here: the planet's own spin runs on sim time, so wall-clock band
  drift would decouple from it under time-warp. Skippable: real giants show no
  perceptible motion at human timescales.

## 9. Invariants

- Visual only: no generation / sim / determinism impact; no new sampled fields
  or RNG draws (§4).
- Effects apply at the **system tier** to near planets; far tiers
  (points/sprites/glow) unchanged. Detail fades with on-screen size (§3.3).
- Behind the `Renderer` seam; the Canvas 2D backend is untouched; all work lives
  on the Three.js path.
- WebGL2-capability baseline via TSL; any WebGPU-only trick is a progressive
  enhancement, never required.
- Bounded work: a handful of planets per system; baked maps evicted on system
  change.
- No runtime toggle: surfaces are always-on realism; tuning lives in
  `config/render` knobs (set via the lab).
- The lab is dev-only and never reachable from the shipped UI.

## 10. Testing

- Static pipeline only for the agent: `npm run build` (tsc + vite),
  `npm test`, and `npm run lint`. Shaders have no unit tests; the pure
  `planet-surface.ts` helpers (data → parameters, regime selection) get small
  tests, mirroring `star-surface.test.ts`.
- **Look and browser verification is Pierre's** (per AGENTS.md): tuning in the
  lab, then in-app checks — does each world type read correctly, is the
  terminator right, no shimmer on small planets, WebGL2 fallback matches
  WebGPU, no perf regression.

## 11. Open questions

- **§3.2 baked vs per-pixel** — decided in Phase 0 (baked recommended).
- **Lab UI** — `lil-gui` dev dependency vs a minimal Preact panel.
- **Rim glow implementation** — Fresnel term vs shell mesh (Phase 1).
- **Cloud layer** — shell mesh vs material layer (Phase 4).
- **Gas-giant hybrid** — only if procedural falls short (Phase 5).
- **Band-motion timebase** — wall-clock vs sim time (Phase 6).

## 12. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-06 | Scope | Planet **surfaces**, system tier only; all looks derived from existing physical data. |
| 2026-07-06 | All-in-one vs split | **Split** — one shippable slice per kind of world, like star-shading. |
| 2026-07-06 | Lighting model | Planets stay **lit** (`MeshStandardNodeMaterial`); the surface drives the albedo (`colorNode`). Star point light keeps the terminator. |
| 2026-07-06 | Runtime toggle | **None.** Surfaces are always-on realism; tune via `config/render` knobs. |
| 2026-09-29 | Iteration workflow | **Planet lab first** (Phase 0): live sliders, Pierre tunes by eye, agent bakes values into config. Replaces blind agent-side iteration. |
| 2026-09-29 | Sequencing | Lab → rim glow → rocky → moons → clouds → static giants → optional giant motion. Gas giants last (hardest look), not first. Rings and oblateness already shipped. |
| 2026-09-29 | Animation | **Static first.** Band motion is a separate, optional final phase with bounded time inputs. |
| 2026-09-29 | Thermal glow | Hottest worlds add an `emissiveNode` on top of the lit albedo; the material stays lit. |
| 2026-09-29 | Albedo source | **Baked per-planet maps recommended** (mipmapped, no small-size shimmer); confirmed or overturned in Phase 0. |
