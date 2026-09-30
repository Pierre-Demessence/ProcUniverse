# 3D star tier with a near-seamless system ↔ star transition

Make the star tier (each system a single point, ~300 AU to ~16 ly across) a
true 3D view that shares the system tier's perspective camera, lighting model
and bloom, and replace the hard system → star swap with a short cross-faded
zoom band so zooming out of a system reads as one continuous camera move.

> Status: **Shipped.** D1 = A now, B later; D2 / D3 took the recommended
> defaults. Pierre browser-tested it; the remaining quirks come from the flat
> (z-less) tiers above it. Deferred items live in the
> [roadmap](../../roadmap.md).

## Current state

- **System tier** (`ThreeRenderer.render`): perspective camera with orbit /
  tilt anchored to the focused system's disk plane (`syncPerspective`), lit
  spheres, orbit rings, star HDR + bloom, the camera-locked starfield dome.
  Systems are streamed as ECS entities (`SystemStreamer`).
- **Star tier** (`ThreeRenderer.renderStars`): orthographic top-down camera,
  one flat `InstancedMesh` of 8-segment discs, sized by `sys.radius` floored to
  `STAR_MIN_DOT_PX`, flat blackbody colour. No bloom, no sky, camera azimuth /
  tilt ignored. Streamed entities are despawned (`streamer.clear()`).
- **Switch:** `selectTier` flips at `SYSTEM_TIER_MAX_AU` (300 AU across) with a
  1.25× hysteresis dead-band. Every visual property changes in one frame:
  projection, camera angle, star size, star brightness, background sky,
  orbit rings, labels.
- **Positions are flat:** `SystemData` has only `x, y` (galactic plane, z = 0).
  Inside a system everything is 3D (`diskNormal`, inclined orbits, `Position3D`).

## Feasibility

**Possible, with one real constraint and one moderate architecture change.**

1. **Flat star positions (the constraint).** Tilting a camera over stars that
   all sit on z = 0 shows a flat plate, not a 3D neighbourhood. The star tier
   only looks 3D once systems have a height. See decision D1.
2. **Discrete tiers (the architecture change).** A seamless transition needs
   both representations on screen at once for a short zoom range. Today the
   frame picks one tier and one render path. The change is to add a continuous
   **blend factor** alongside the discrete tier and render the system and star
   layers into **one shared perspective scene**. Tier selection, streaming and
   persistence stay tier-based; only rendering becomes blended. This is
   contained to `render-systems.ts`, `three-renderer.ts` (star-tier path
   rewritten), `lod/tier.ts` (blend helper) and streaming hysteresis — not a
   rewrite of the LOD model.
3. **Not in scope / not seamless:** star → galaxy stays a hard swap (the galaxy
   tier is an aggregate glow under an orthographic camera). The star tier eases
   its tilt toward top-down near that boundary so the swap does not jump angle.
   Full distance-based LOD and a 3D galaxy are the larger Stage 3 work in
   [rendering-backend.md](../rendering-backend.md) and are not required here.

## Design

### Shared perspective camera

- The star tier uses `syncPerspective` with the same `zoom → distance`
  mapping, azimuth and tilt as the system tier, so the camera does not move at
  the switch. The orthographic camera remains only for the galaxy /
  galaxy-field / universe tiers.
- **Reference plane:** the system tier anchors the orbit frame to the focused
  system's `diskNormal`; the star tier anchors to the galactic plane (+z).
  Across the blend band the normal is slerped from disk to galactic so the
  view rotates gradually instead of snapping. (See risk R1.)
- Right-drag orbit / tilt, left-drag pan along the plane, and "Flatten" work
  identically at the star tier.
- Perspective clip planes: near/far derived from the visible star volume
  (view span plus the height spread from D1); reversed depth is already on.

### Star rendering (prettier)

- **Point sprites, not discs:** camera-facing instanced quads with a radial
  core + halo profile (same technique as the starfield dome's sprites), in a
  TSL node material.
- **Apparent brightness from physics:** intensity from luminosity and camera
  distance (inverse square → log / magnitude-like mapping, clamped), so near
  and luminous stars dominate and the field has a steep bright-to-faint
  distribution, like the real sky. Size grows gently with brightness.
- **Colour:** blackbody colour already on `StarPhysical`, with a slight
  saturation boost for readability.
- **HDR + bloom:** the brightest stars exceed `BLOOM_THRESHOLD`; the star tier
  renders through the same bloom `RenderPipeline` as the system tier, so glare
  looks identical across the transition.
- **Background:** the starfield dome's diffuse galaxy band (and dust) stays as
  the backdrop at the star tier; the dome's statistical point stars fade out
  there, since real neighbours now fill the foreground.
- **Optional polish (Phase 4):** subtle diffraction spikes on the brightest few
  stars, depth cue (distance-faded brightness), labels for the nearest /
  brightest named stars, hover highlight.

### Continuous transition (system ↔ star)

- `tierBlend(cam)` in `lod/tier.ts`: 0 inside the system tier, 1 in the star
  tier, smooth-step across a zoom band around `SYSTEM_TIER_MAX_AU` (band width
  a config knob, e.g. 100 → 900 AU across).
- Within the band, one frame renders both layers in the shared scene:
  - **System layer:** planets / moons / rings fade out (opacity or shrink to
    points), orbit rings fade, the system's star sphere + glare stays.
  - **Star layer:** neighbour star sprites fade in.
  - **The focused star is drawn once:** its sprite is suppressed while its
    sphere is visible and takes over as the sphere fades, with brightness /
    size matched at the handoff (the sphere is already floored to
    `STAR_MIN_SCREEN_PX` and bloomed, i.e. it already looks like a point).
- **Streaming across the band:** ECS systems stay streamed until blend = 1
  (widen streaming hysteresis) so the fade-out has bodies to fade; on zoom-in
  they must be streamed before blend drops below 1 (stream from the band's
  outer edge). Only the focused / nearest system needs full bodies in the band,
  which bounds the cost.
- **Tier boundary itself** (`selectTier`) keeps its role for streaming,
  selection, HUD and labels; rendering uses the blend.

## Decisions

- **D1 — how stars get a height. Decided: A now, B later.** Pierre's end goal
  is B. A first is the better order: everything else in this plan (shared
  camera, sprites, bloom, blend, streaming) is independent of where `z` comes
  from, so it ships and gets tuned now, and B later only swaps the source of
  `z`. Constraint this imposes: every consumer reads height through
  `SystemData.z` / `systemZ`, never a separate formula, so B is a drop-in
  replacement (B will move star heights; acceptable, the universe is
  regenerated anyway by that change).
  - **A (recommended first step): visual height, per system.** A
    deterministic `systemZ(seed, …)` drawn **last** from each system's own RNG
    stream (append-only, so no other generation changes), spread over a slab
    of configurable thickness. `SystemData` gains `z`; spawn / render / picking
    use it. Galaxy, cosmic web and tier logic stay flat. Cheap, gives a real 3D
    neighbourhood, and the single `systemZ` function is the seam Stage 3 later
    replaces. Caveat: the slab is a local look, not a physical galactic disk
    (the real thin disk is hundreds of ly thick — far more than the star tier's
    ~16 ly view — so a faithful model is a 3D volume, see B).
  - **B: true 3D sectors (Stage 3).** 3D sector grid and hashing, 3D galaxy
    density with thickness / bulge, streaming by 3D range, 3D render origin,
    distance-based LOD. Correct long-term and unlocks the hybrid sky
    ([starfield-enhancements.md](../../research/starfield-enhancements.md) §1)
    and a 3D galaxy tier, but a large, universe-shifting change touching
    generation, LOD, camera, persistence and bookmarks. Better as its own plan.
- **D2 — does the focused system's plane stay the reference at the star tier,**
  or does the view settle onto the galactic plane (recommended: settle to the
  galactic plane across the blend band; see R1).
- **D3 — star size meaning:** physical-radius hint (current) vs. apparent
  brightness only (recommended: brightness; radius is invisible at ly scale).

## Implementation notes

Where the build differs from, or adds to, the design above:

- **Zoom-to-point (new).** At the star tier the wheel dollies the focus toward
  a 3D target — the star sprite under the cursor (within `PICK_PX`), else the
  cursor ray's hit on the reference plane — scaling the focus→target offset by
  the zoom ratio, so the target stays under the cursor. Zooming onto a star
  converges on it in x, y and z, so the system tier lands on that star
  (`CameraController.setZoomTargetResolver`, `ThreeRenderer.zoomTargetAt`).
  The system tier keeps the flat 2D cursor pin.
- **Origin height.** While the system layer shows, the render origin snaps to
  the focused star in z too (`FrameState.renderOriginZ`); `focusZ` is local
  to it and rebased with it. The save and bookmarks store absolute z; old
  bookmarks take the height of the nearest system (`bookmarkZ`).
- **Plane basis.** The orbit basis is the galactic basis (u = −ŷ, v = x̂)
  carried by the minimal rotation ẑ → N (`planeBasis`), so the disk → galactic
  swing is continuous. For non-flat disks the azimuth reference differs from
  the old `ẑ × N` rule (a saved view inside a tilted system opens rotated once).
- **Handoff.** The focused star's sphere shrinks (`BodyFrame.starScale`) as its
  sprite fades in over `STAR_HANDOFF_START`→1; planets and moons shrink via
  `applyBodyScale`'s fade; orbit lines fade by opacity. Label layers cross-fade
  with `globalAlpha`.
- **Neighbour cull.** In the band the far plane reaches the star field, so body
  meshes and labels beyond `SYSTEM_LAYER_REACH_AU` of the focused star are
  hidden (black holes exempt); neighbours show as sprites.
- **Star field extent and cost.** Stars are drawn within the view half-span
  widened by the tilt (min `STAR_MIN_REACH_LY`), fading out over the outer
  quarter. Missing sectors generate nearest-first within
  `STAR_SECTOR_BUDGET_MS` per frame (R2 mitigation; ~1 ms per dense-core
  sector).
- **Click at the star tier** flies into the system and selects the star via
  the bookmark path (resolves once streamed); hover draws a reticle + name.
- **Star → galaxy swap.** Tilt eases to the nearest straight-along-the-normal
  pose; the orthographic galaxy view is mirrored in y relative to a top-down
  perspective view, so the swap still flips (tracked in the roadmap).

## Risks

- **R1 — reference-plane swing.** Blending from a steeply inclined disk plane
  to the galactic plane rotates the view during the zoom; could feel like a
  roll. Mitigation: slerp over the full band; fallback: keep the focused
  system's plane for the whole star tier and only realign at the galaxy swap.
- **R2 — generation hitches.** Zooming out to 16 ly brings in up to ~256
  sectors, each generated in full (planets, moons, names). Already a roadmap
  item; the blend makes the zoom-out path more visible. Star-only sector
  records (or a per-frame generation budget) may become a prerequisite.
- **R3 — precision.** 16 ly ≈ 10⁶ AU in view; stars are positioned relative to
  the floating render origin and `highPrecision` is on, so float32 jitter
  should stay sub-pixel. Verify at the band edges.
- **R4 — double star at handoff.** Mismatched sphere-glare vs. sprite
  brightness would flash. Needs a shared brightness function and a crossfade.
- **R5 — star → galaxy swap from a tilted view.** Mitigated by easing tilt to
  top-down near `GALAXY_TIER_SECTORS`.

## Phases & checklist

### Phase 0 — decisions

- [x] D1: A now, B later (B tracked in the roadmap's "3D beyond the system
      tier" decision and [rendering-backend.md](../rendering-backend.md) Stage 3).
- [x] D2 / D3: recommended defaults taken (settle to the galactic plane;
      brightness-only star size).

### Phase 1 — 3D star positions (D1 = A)

- [x] `systemZ` appended draw + slab-thickness knob in `config/data.ts`.
- [x] `SystemData.z`; spawn places the star (and its bodies) at `z`.
- [x] Update `nearestSystem` (today a 2D search of the camera's sector only),
      focus / lock and picking for `z`.
- [x] Bookmarks gain `z` with backward-compatible loading (old saves → z
      recomputed from the seed).
- [x] Determinism test: all existing fields unchanged for a fixed seed; `z`
      stable.

### Phase 2 — 3D star tier (hard switch still in place)

- [x] Star tier renders through the perspective camera (`syncPerspective`,
      galactic plane) and the bloom pipeline.
- [x] Star sprite material (core + halo, HDR), apparent-brightness function
      with unit tests; replace the disc `InstancedMesh`.
- [x] Dome at star tier: band glow kept, dome point stars faded out.
- [x] Controller: orbit / tilt / flatten / plane-anchored pan active at star
      tier; tilt eases to top-down near the galaxy boundary.
- [x] Picking + hover at the star tier (raycast / screen-distance against
      sprites) — covers the roadmap "click a system at the star tier" item.

### Phase 3 — continuous transition

- [x] `tierBlend` helper + band-width knob; unit tests.
- [x] Render path merged: one scene, system and star layers weighted by blend.
- [x] Body / orbit-ring fade-out; focused-star sphere ↔ sprite handoff.
- [x] Reference-plane slerp across the band.
- [x] Blend-aware streaming: `SystemStreamer` is all-or-nothing per tier
      today; keep (at least the focused) system spawned while 0 < blend < 1.
- [x] Star-tier clip planes cover the view span plus the height slab.

### Phase 4 — polish

- [x] Brightest-star diffraction spikes (optional, knob).
- [x] Labels for nearest / brightest named stars at the star tier.
- [x] Perf check near a galaxy core (sector generation, sprite count) — Node
      measurement (~1 ms / core sector, now budgeted); per-tier frame-time
      budgets stay on the roadmap.

### Wrap-up

- [x] `npm run build` + `npm test` + `npm run lint` green.
- [x] Pierre browser-tests the zoom.
- [x] Update `docs/features.md`, `docs/codebase.md`, `docs/agent/README.md`,
      roadmap; mark `rendering-backend.md` Stage 3 progress.
- [x] Sweep deferred items into the roadmap (star-tier polish, R1 fallback,
      hover perf, star-only sector records, hybrid sky, renderer split).
- [x] Move this plan to `done/`.
