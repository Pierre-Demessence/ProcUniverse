# Procedural Star Shading — first slice of Stage 2

The **first focused piece** of the system-visuals roadmap
([system-visuals.md](../system-visuals.md)): make stars look like stars instead of
flat "yellow circles", and light the system realistically from the star.

Part of **Stage 2 (shader effects, R2)** in
[rendering-backend.md](../rendering-backend.md), system tier only.

> Status: **in progress.** Surface shader (limb darkening, blackbody colour,
> granulation/starspots, flicker), realistic single point-light lighting, the
> **corona (post-process bloom)**, and the **far-star visibility floor** have all
> landed; green on build + tests + lint and peer-reviewed. Browser verification
> is Pierre's per AGENTS.md — in particular the bloom on the WebGL2 fallback and
> that the bloom pipeline coexists cleanly with the direct-rendered glow tiers.

## 1. Goal

A star in the system view should read instantly as a glowing sphere of *its*
temperature and size — hot ones blue-white and fierce, cool ones deep orange
and mellow — with a soft corona, a mottled living surface, and correct light
spilling onto the planets around it.

## 2. Why it looks flat today

The star is a real sphere, but it uses a **self-lit (emissive) material** that
paints one uniform colour across the whole surface and ignores all lighting
(see [three-renderer.ts](../../../src/render/three/three-renderer.ts#L404)). A
uniformly coloured ball is indistinguishable from a flat disc at any angle —
hence the "circle". A cast shadow can't fix this: a star makes its own light,
so nothing lights it from outside. The roundness cue has to come from the
star's own physics.

## 3. Approach

Replace the star's flat emissive material with a **procedural TSL shader** on
the star sphere (WebGPU path, WebGL2 fallback). All inputs come from the
already-computed `StarPhysical` data — no new sampled fields, so the universe is
byte-identical (purely visual).

### 3.1 Feature checklist

- [x] **Limb darkening.** Dim + slightly redden the disc toward its edge (you're
      seeing through more of the cooler outer layers there). This is *the* cue
      that makes a self-lit ball look spherical. Strength/tint from
      `temperature`.
- [x] **Blackbody colour across the surface.** Base colour from `colorHex` /
      `temperature` (already the real blackbody curve), varied subtly across the
      surface rather than one flat fill.
- [x] **Granulation + starspots.** Slow-moving procedural noise for the boiling,
      mottled surface + darker spots. Cooler stars → larger, redder, calmer
      cells; hotter stars → finer, brighter, bluer. Scale/contrast from
      `temperature`.
- [x] **Corona / glow halo.** A soft glow past the star's edge so it bleeds
      light like a real star (today it has a hard cutoff). Delivered as a
      **post-process bloom** (§5) — the physically-real "bright pixels bleed
      light" effect — with brightness/spread scaled by `luminosity` (and/or
      `radius`).
- [x] **Star stays visible from far.** From a distant planet the star's true
      disc shrinks below a pixel and vanishes, but a real star stays a blazing
      point of glare. Floor the star's on-screen size to a minimum pixel radius
      so it never fully disappears; bloom then renders it as a glowing point.
- [x] **Gentle flicker.** Very subtle brightness shimmer over time so the star
      feels alive, not frozen, driven by **wall-clock** time (§5). (Kept small —
      not a strobing pulsar.)

### 3.2 Realistic star lighting (bundled here — it's the star's light)

The star *emits* the light; that emission is part of shading the star, so it
belongs in this plan. **Planet materials are out of scope** — we only change the
light source, not how planets react to it (planet surfaces are a later
workstream in [system-visuals.md](../system-visuals.md)).

- [x] **Point light at the star.** Replace the fixed directional key light with
      a **point light positioned at the star's location**, so planets/moons are
      lit on the hemisphere facing the star and the lit face tracks their orbit.
      Intensity can scale with `luminosity`. (Planets improve as a free side
      effect of the corrected light — no planet-material changes.)
- [x] **Ambient review.** Decide the small ambient fill vs near-black far side
      (see roadmap open question) — likely keep a low ambient for readability.
      *(Kept `LIGHT_AMBIENT` = 0.35; the point light with `decay = 0` lights the
      whole system evenly for readability.)*

## 4. Data inputs

| Field (`StarPhysical`) | Used for |
| ---------------------- | -------- |
| `temperature` (K) | limb-darkening tint, granulation scale/colour, surface colour |
| `colorHex` | base blackbody colour |
| `luminosity` (L☉) | corona size/brightness, point-light intensity |
| `radius` (R☉) | corona scale relative to disc |

No new fields, no new RNG draws → universe unchanged.

## 5. Technical notes

- Star spheres come from the pooled mesh in `obtainSphere` /
  [three-renderer.ts](../../../src/render/three/three-renderer.ts#L307); the star branch
  currently sets `emissive = fill`. The shader replaces that material for stars
  (planets/moons keep their lit `MeshStandardMaterial` for now).
- Author in **TSL** so it runs on both WebGPU and the WebGL2 fallback from one
  source.
- **Corona = post-process bloom.** A full-screen bloom pass makes bright pixels
  bleed light outward — the physically-real halo, exactly what a camera or eye
  does looking at something very bright. It is shared Stage 2 infrastructure:
  the same bloom will glow the future black-hole accretion disk and bright
  nebulae, so building it here serves the whole roadmap rather than being a
  per-star trick. (Fallback if bloom infra proves too heavy for this slice: a
  camera-facing billboard glow sprite sized by `luminosity`. Not the goal —
  bloom is.) This is **new, purpose-built rendering**, not a reuse of the
  prototype glow sprites.
- **Flicker/granulation drift use wall-clock time**, not `simSeconds`. Sim time
  freezes the star when paused and strobes/vanishes it under heavy time-warp —
  both are exactly when the user is staring at a star. Since the shimmer is
  cosmetic, wall-clock has no realism cost and always looks alive.

## 6. Invariants

- Visual only: no generation/sim/determinism impact, no new sampled fields.
- Effects apply at the **system tier** to near stars; the star-tier dots and
  glow sprites are unchanged.
- Behind the `Renderer` seam; Canvas 2D backend untouched.

## 7. Testing

- Static pipeline only for the agent: `npm run build` (tsc + vite) + `npm test`
  - lint. Shaders have no unit tests; any extracted pure helpers (e.g. a
  temperature→granulation-parameter mapping) get small tests.
- **Browser verification is Pierre's** (per AGENTS.md): does the star read as a
  sphere, is limb darkening/corona right, are planets lit from the star, does
  the WebGL2 fallback match the WebGPU path, no perf regression.

## 8. Open questions

- Selective bloom: the current approach makes **stars** HDR-bright (emissive
  × `STAR_EMISSIVE_STRENGTH`) and sets `BLOOM_THRESHOLD` above the lit-planet
  brightness so mostly stars bloom. If lit planet faces bloom too, raise the
  threshold (or move to MRT emissive-channel bloom later). Tune in-browser.
- Bloom cost on the WebGL2 fallback path vs WebGPU — confirm no perf regression
  in-browser.

## 9. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-04 | Scope | **Stars only.** Planet materials are untouched; the only planet-facing change is the corrected light source (§3.2). |
| 2026-07-04 | Flicker time base | **Wall-clock**, not sim time — avoids frozen-when-paused and strobing-under-time-warp; cosmetic so no realism cost. |
| 2026-07-04 | Corona mechanism | **Post-process bloom** (physically-real light bleed, shared Stage 2 infra). Billboard sprite is a fallback only. Explicitly **not** a reuse of the prototype glow sprites. |
| 2026-07-04 | Settings toggles | **Deferred** — no toggles this slice; tune via config knobs in-browser. |
| 2026-07-04 | Lighting: how many lights | **A single point light at the star nearest the camera focus**, not one per star. Many stars are streamed into the world (neighbouring systems, frustum-clipped from view); per-star decay-free lights stacked and blew planets out. |
| 2026-07-04 | Point-light falloff | **decay = 0** (constant across the system) for readability, over strict inverse-square which would black out outer planets. |
| 2026-07-04 | Tuning values (Pierre, in-browser) | `LIGHT_AMBIENT = 0.15`, `LIGHT_STAR_BASE = 3`. |
| 2026-07-04 | Selective bloom | Stars are boosted to **HDR** (emissive × `STAR_EMISSIVE_STRENGTH`) and the bloom **threshold** is set above lit-planet brightness, so mostly stars bloom without MRT plumbing. Revisit with an MRT emissive channel if planets bloom. |
| 2026-07-04 | Far-star visibility | Floor the star's on-screen radius to `STAR_MIN_SCREEN_PX` so its shrinking true disc never vanishes; bloom turns the floored dot into a visible glare point (matches how a real star stays a bright point from a distant planet). |
