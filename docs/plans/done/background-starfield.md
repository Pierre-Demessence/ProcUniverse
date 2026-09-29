# Background Starfield — Plan

A procedural galaxy-aware background starfield behind all tiers, so the sky
around a focused system reflects its local galaxy (dense + blue in arms,
sparse + red in voids, with a faint disk band) instead of being flat black.

> Parent: [system-visuals.md](../system-visuals.md) workstream **C**.
> Status: **planning.** Nothing here is implemented yet.

## 1. What we already have

- **Three.js renderer** (`src/render/three/three-renderer.ts`) with WebGPU/WebGL2
  dual backend, instanced meshes for glow sprites and star dots, a perspective
  camera for the system tier, and an orthographic camera for other tiers.
- **Galaxy data functions** (`src/generation/galaxies.ts`):
  `galaxyDensityOf(g, x, y)`, `galaxyActivityOf(g, x, y)` — density and
  star-formation activity at any world position for a single galaxy.
  `galaxyDensityAt(seed, x, y)`, `galaxyActivityAt(seed, x, y)` — aggregate over
  the dominant galaxy at a point.
- **Population colour ramp** (`src/render/galaxy-sprites.ts`):
  `populationColor(t)` — red (old, t→0) → white → blue (young, t→1).
- **TSL shader infrastructure** — star-surface.ts already demonstrates TSL
  procedural shaders on sphere materials in this codebase.
- **Instanced mesh pattern** — glow-fields.ts and renderStars demonstrate
  feeding instanced meshes from CPU iterators.

## 2. What we need to build

### 2A. The starfield dome

A large inverted sphere (inside-facing) at the scene origin with a
**CPU-generated equirectangular texture** produced via Canvas2D. The dome sits
at origin because the Three.js scene uses render-origin coordinates — the
camera is always near origin, so the dome always encloses it.

- The sphere radius is `1e8` AU — far larger than any render-space content.
- The dome is static at scene origin (no per-frame repositioning needed).
- A `MeshBasicMaterial` with `side: BackSide`, `depthTest: true`,
  `depthWrite: false` so scene content draws on top.
- The dome is rotated `-π/2` around X to align the Three.js Y-up sphere
  geometry with the texture's Z-up convention.

### 2B. The texture

Generated once per galaxy+camera-quadrant and cached (up to 8 entries, LRU
eviction). The texture is regenerated when the camera travels ~50 kAU within a
galaxy, or when moving to a different galaxy / the void.

**Algorithm** (CPU, Canvas2D):

1. For each of ~180,000 candidate stars, pick a random pixel in the
   equirectangular texture.
2. Map the pixel to a 3D view direction via `pixelToDir`.
3. Probe the galaxy density/activity at a point ~50 kAU along that direction
   using the existing `galaxyDensityAt` / `galaxyActivityAt` functions.
4. Rejection-sample: keep the star with probability proportional to density ×
   core-facing bonus × disk-plane bonus.
5. Paint a soft anti-aliased disc at the pixel; colour from the existing
   `populationColor` ramp, brightness randomized.
6. After stars, paint a faint continuous "Milky Way band" along the texture
   equator (disk-plane directions).

**Fallback (no dominant galaxy):** sparse uniform random stars, no band.

### 2C. Per-frame update

Each frame, `updateStarfield` finds the dominant galaxy via `galaxyAt`, computes
render-space coords, and calls `dome.update()`. The dome swaps its material to
the cached texture (or generates a new one on cache miss). The call is in
`main.ts`, before the tier-specific Three.js rendering.

### 2D. Integration into the render loop

The starfield dome is added once to the Three.js scene. It is a **camera-locked
skybox**: each frame at the system tier the renderer recentres the dome on the
camera and scales it so its radius sits at the midpoint of the perspective
camera's `near`/`far` range. The material uses `depthTest: false`,
`depthWrite: false` with `renderOrder = -1`, so it always draws first as a pure
background and all scene content draws on top. The dome is hidden on the
top-down orthographic map tiers (star / galaxy-field / galaxy / universe).

> **Bug fix, 2026-07-06 (takeover).** The original implementation used a
> **fixed** dome of radius `1e8` AU centred at the scene origin, on the
> assumption that "the dome always encloses the camera". That ignored the
> camera **near/far clip planes**: the system-tier perspective far plane is only
> hundreds of AU, and the map-tier orthographic far plane is `2000`, so a `1e8`
> dome was clipped away at every realistic zoom — the starfield essentially
> never appeared (occasionally a stretched equatorial sliver leaked through at
> the most zoomed-out map tiers, which read as a blurry smear). The skybox
> approach above (recentre on camera + fit radius inside near/far) fixes it.

## 3. Implementation steps

- [x] **3.1** Create `src/render/three/starfield.ts` — CPU-generated
  equirectangular texture on a dome sphere with texture cache.
- [x] **3.2** Wire the dome into `ThreeRenderer` — `updateStarfield` method,
  lazy dome creation, scene integration; called from `main.ts` each frame.
- [x] **3.3** Write unit tests for `pixelToDir` (the only pure exported function).
- [x] **3.4** Peer review + fixes (coordinate system alignment, cache key).
- [x] **3.5** Static pipeline verified: build ✓, 251 tests ✓, lint ✓.
- [x] **3.6** Fix near/far clipping — camera-locked skybox (recentre on camera,
  fit radius inside near/far, `depthTest:false` + `renderOrder:-1`, system-tier
  only). Build ✓, 251 tests ✓, lint ✓.
- [x] **3.7** Fix blur — replaced the baked equirectangular star texture with
  resolution-independent **camera-facing instanced sprites** (an `InstancedMesh`
  of small additive quads, each billboarded toward the dome centre / camera,
  coloured per star and brightness-scaled). Stars are now crisp at any zoom /
  FOV. GPU points were tried first but the WebGPU backend renders them at only
  1px (invisible when dim), so instanced quads — the pattern the star/glow tiers
  already use — are used instead. The faint Milky-Way band stays a single shared
  low-frequency texture (soft by design). Star directions are uniform-on-sphere
  sampled (no pole clumping) and cached per galaxy. Build ✓, 251 tests ✓, lint ✓.


## 4. Performance considerations

- The dome is a single 32-segment sphere → negligible geometry cost.
- The fragment shader runs for every screen pixel, but:
  - The hash + density math is modest (a few sin/cos + multiplies per pixel).
  - Most pixels are black (no star) — the density check exits early for ~95%+
    of pixels.
  - No texture reads (pure math).
- At the system tier, the post-process bloom pipeline already runs; the starfield
  renders into the same scene pass and gets bloom for free if its star pixels
  exceed the threshold — but we likely want to keep background stars below the
  bloom threshold (subtle pinpricks, not glowing coronae). This is tunable via
  the star brightness uniform.
- If the shader ever becomes a fill-rate bottleneck, the dome resolution
  (segments) can be lowered, or the starfield can be rendered at half-res and
  upscaled.

## 5. Open questions

- ~~Should background stars participate in bloom?~~ No — background stars are
  subtle pinpricks. Resolved by using a non-emissive texture (standard
  `MeshBasicMaterial`), which doesn't trigger the bloom threshold.
- ~~Should the starfield react to the "Flatten" toggle?~~ N/A — the dome is a
  sphere, so the star distribution is the same regardless of camera tilt.
- ~~Should the starfield have an on/off toggle?~~ No — always on, per Pierre.
- **Milky Way band prominence:** 10% brightness (subtle), tunable via
  `BAND_BRIGHTNESS` constant.
- **Dome approach:** Static at scene origin (render space always near origin),
  not camera-following. Simpler and functionally equivalent.

## 6. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-07-04 | Approach | **CPU-generated equirectangular texture** on a dome sphere (not TSL shader). TSL cell-grid hashing proved fragile with the current type system; Canvas2D generation uses the exact galaxy math, is simpler to debug, and the texture is cached per galaxy. |
| 2026-07-04 | Camera attachment | Dome is **static at scene origin** — render-space origin is always near the camera, so the dome always encloses it. No per-frame repositioning needed. |
| 2026-07-04 | Depth | `depthTest: true, depthWrite: false` — scene content draws on top naturally. |
| 2026-07-04 | Bloom | Background stars use standard `MeshBasicMaterial` — no emissive/HDR, so they never trigger bloom (subtle pinpricks). |
| 2026-07-04 | Galaxy math | Uses the **exact** `galaxyDensityAt` / `galaxyActivityAt` (CPU-side, no simplification). |
| 2026-07-04 | Void fallback | Sparse uniform random stars (no galaxy structure) when no dominant galaxy. |
| 2026-07-04 | Toggle | Always on, per Pierre — no settings toggle. |
| 2026-07-04 | Coordinate alignment | Dome rotated `-π/2` around X to align Z-up texture convention with Three.js Y-up sphere geometry. |
| 2026-07-04 | Cache strategy | Texture cached per galaxy + coarse camera quadrant; LRU eviction (max 8 entries). |
