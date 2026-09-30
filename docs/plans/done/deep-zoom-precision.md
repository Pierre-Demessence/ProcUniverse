# Deep zoom on system bodies (moon close-ups)

## Goal

Let the system view zoom in far enough that the smallest moon (~490 km radius,
`MOON_MASS_MIN`) can fill the screen, without jitter, depth artefacts or
misplaced orbit lines. `MAX_ZOOM` goes from `1e7` to `1e9` px/AU (~150 m/px).

## Why the old cap existed

At the system tier the render origin is the focused star, so body positions are
tens of AU. three.js WebGPU builds the model-view matrix on the GPU in float32
by default (`mediumpModelViewMatrix`), quantising positions to ~ULP(30 AU) ≈
300 km — a visible shake at deep zoom. Other float32 world-space paths (orbit
ring vertices, the atmosphere's camera position, the ring shadow) and the
near/far depth ratio break down the same way.

## Changes

1. **High-precision model-view** — `renderer.highPrecision = true` computes
   `camera.matrixWorldInverse × object.matrixWorld` in JS (float64) per object,
   so only small camera-relative values reach the GPU.
2. **Reversed float depth** — `reversedDepthBuffer: true` (Depth32Float; the
   bloom `PassNode` switches its depth texture to float too). Keeps depth
   ordering valid with a near plane of ~1e-7 AU and a far plane of ~100+ AU.
   WebGL2 fallback uses it when `EXT_clip_control` exists, else three warns and
   falls back to the standard buffer.
3. **Orbit rings** — vertices are written relative to the camera focus (the
   merged mesh is positioned at the focus), and a ring that would need more
   than `RING_MAX_SEGMENTS` over its whole length is tessellated only over the
   arc near the focus, so the chord error stays sub-pixel at any zoom.
4. **Atmosphere shader** — the camera position in the planet's local frame is a
   per-object uniform computed on the CPU (float64) instead of
   `modelWorldMatrixInverse × cameraPosition` on the GPU.
5. **Ring shadow** — the fragment offset from the planet centre comes from the
   model matrix's linear part applied to `positionLocal` (the ring mesh is
   centred on the planet) instead of `positionWorld − uPlanetCenter`.
6. **Label clipping** — `projectToScreen` clips on view-space depth against
   `near`/`far`; reversed depth maps far to NDC z = 0, so the old `z < 1` test
   let labels of neighbouring systems through.
7. **Distance format** — adaptive units show metres below 1 km (scale bar).
8. **`MAX_ZOOM = 1e9`.**

## Out of scope (tracked in `docs/roadmap.md`)

- Sharper moon surface maps up close (moons bake at 256 px wide; a close-up
  LOD re-bake for the focused body).

## Checklist

- [x] High-precision model-view + reversed depth buffer
- [x] Clip-plane comment updated for float depth
- [x] Orbit rings: focus-relative vertices + visible-arc tessellation (+ tests)
- [x] Atmosphere camera-local uniform on CPU
- [x] Ring shadow from model-space offset
- [x] Label clipping on view-space depth
- [x] Metres in adaptive distance format (+ test)
- [x] `MAX_ZOOM = 1e9`
- [x] Roadmap entry for moon texture LOD
- [x] Docs updated (features, agent README)
- [x] Build + tests + lint green; peer review
