# Rendering Backend — GPU, Shaders, and 3D

Recommendation and staged plan for moving ProcUniverse beyond Canvas 2D so it
can (a) draw far more stars at once, (b) use shaders for star / black-hole /
nebula effects, and (c) optionally show planets as textured spheres and/or go
3D — all without throwing away the deterministic generation, physics, sim, and
HUD layers already built.

> Status: **design approved, scheduled later.** No code yet — this lands after
> the realism/data session. Decisions captured in §10; the stages in §7 reflect
> them (full 3D on Three.js, WebGPU-with-WebGL2-fallback, R1 + R2 first).

## 1. TL;DR recommendation

_Updated after decisions: full 3D is the goal, Three.js is the engine, R1 + R2
first then R3, and the work is scheduled after the realism/data session._

1. **Go full 3D on Three.js.** Real rotating star/planet spheres, a pan + tilt +
   orbit camera, a Z axis, and gently-inclined orbits. Three.js supplies the 3D
   scene graph, cameras, raycast picking, and sphere/material/lighting pipeline
   so we don't hand-roll a 3D engine.
2. **Build on Three.js `WebGPURenderer`, which auto-falls-back to WebGL2.**
   Author shaders once in **TSL** (Three Shading Language); the renderer runs
   WebGPU where present and WebGL2 everywhere else from the _same_ code. This
   dissolves the WebGPU-vs-WebGL dilemma: we get WebGPU's ceiling **and** keep
   long-tail compatibility, instead of choosing one. (See §4 for the honest
   perf/capability breakdown — the compatibility "cost" is near zero here.)
3. **R1 (many stars) + R2 (shader fx) first, R3 (planet textures) next.** The
   stage order in §7 follows this.
4. **The realism/data investment survives.** Going 3D rewrites coordinates +
   camera + view and adds orbital inclination, but **all per-body physics,
   naming, inspector, persistence, time, and determinism are untouched** (§6).
5. **Ship a "view as flat" toggle.** Because each system is near-coplanar
   (§6C), a top-down/flatten mode is cheap and preserves the readable 2D feel
   for users who want it.

## 2. Where we are today

| Concern | Today |
| ------- | ----- |
| Backend | Canvas 2D (`CanvasRenderingContext2D`) only. |
| Renderer seam | Engine `Renderer<TCtx>` interface (one method: `render(ctx)`). The engine already ships `render-canvas2d` **and** `render-dom`, proving multi-backend is intended; the interface doc names WebGL / PIXI explicitly. |
| System tier | Uses the engine `Canvas2DRenderer` for star + planet discs; orbit rings, labels, grid drawn by hand. |
| Star / galaxy / galaxy-field / universe tiers | Hand-rolled immediate-mode Canvas 2D (`drawStars`, `drawGalaxy`, `drawGalaxyField`, `drawUniverse`): loop visible cells/systems, `fillRect` / `arc`, or blit a cached radial-glow sprite with `globalCompositeOperation = 'lighter'`. |
| Why it scales today | LOD aggregation keeps the on-screen object count bounded (low thousands) at every zoom — we never actually draw a million things; we draw an aggregate glow instead. |
| Coordinates | Fully 2D: `PositionDef {x, y}`, sectors / galaxies / cosmic web all on a plane, orbits coplanar (`sim/orbits.ts`), camera is the engine 2D `Camera` (x / y / zoom). |
| Float precision | Handled by a **floating render origin** (rebased as the camera travels) so the renderer always sees small local coords. |
| Data richness | Generation already produces deep per-body physics (star T / class / colour / age / metallicity; planet type / density / temp / composition / atmosphere / oblateness / rotation / obliquity / moons / rings / tidal-lock; black-hole mass / spin / accretion; galaxy morphology / populations). **This is exactly the input a shader/texture pipeline wants — it already exists.** |

Key takeaway: the codebase is cleanly layered. Generation → sim → render is a
one-way dependency, and rendering already sits behind a swappable interface. The
GPU work is therefore **additive at the render seam**, not a teardown — _until_
the moment we choose true 3D, which reaches back into coordinates.

## 3. Requirements restated

| # | Want | What it actually needs |
| - | ---- | ---------------------- |
| R1 | Zoom out very far, tons of stars at once | GPU **instanced** points/sprites: one draw call for N stars. Relaxes (or removes) the aggregate-glow LOD for the star tier. |
| R2 | Shaders for stars, black holes, etc. | **Fragment shaders**: star corona / flare, black-hole accretion + lensing, nebula / cosmic-web volumetrics. WebGL2 GLSL ES 3.00 is sufficient. |
| R3 | "Textures" for planets from data | A shader that consumes a planet's data as uniforms → a flat lit disc (2D impostor) or a UV sphere (3D). Can render once to a cached texture per body. |
| R4 | Full 3D (confirmed) | Real spheres + pan/tilt/orbit camera + Z axis + inclined orbits — see §6. The chosen path, not a maybe. |

R1–R3 are delivered **inside** the 3D scene (§7). R4 is confirmed, so the shape
is "build the 3D renderer, then layer R1 / R2 / R3 effects into it."

## 4. WebGPU vs WebGL2 — the honest perf / capability breakdown

Your framing is exactly right: it's a cost/benefit between **compatibility lost**
and **perf/capability gained**. The headline "WebGPU is faster" is true only for
_specific_ workloads — it is **not** a flat "+300% everywhere." Here is where the
difference is real and where it isn't.

### Where WebGPU genuinely wins (big)

| Win | Why | Magnitude | Matters for us? |
| --- | --- | --------- | --------------- |
| **Compute shaders** | WebGL2 has **none**. WebGPU runs GPU particle sim, GPU frustum/LOD culling, and procedural generation on the GPU. | Capability gap (impossible → possible); can lift object-count ceilings ~10×. | **Yes** — GPU-culled instanced stars could push the visible-star count far past a comfortable WebGL2 budget (R1). |
| **Draw-call / CPU overhead** | Explicit command buffers + render bundles; no per-call global-state validation. | ~2–4× lower CPU cost on **draw-call-bound** frames (thousands of distinct draws). | **Partly** — only with many heterogeneous draws. Aggressive instancing (one draw for all stars) already neutralises this in WebGL2. |
| **Storage buffers** | Large structured read/write buffers in shaders. | Simpler + sometimes faster data-heavy shaders (WebGL2 is stuck with ≤~16 KB UBOs + texture-packing tricks). | **Somewhat** — handy for feeding rich per-body data to shaders (R3). |

### Where it's basically a tie

| Equal | Why |
| ----- | --- |
| **Fragment-shader throughput** | Star coronae, planet surface shaders, nebula noise run on the **same silicon**. A fullscreen effect is ~the same fps on both. So **R2 gains little from WebGPU itself**. |
| **Normal mesh / triangle throughput** | Drawing sphere planets is the same. |
| **Texture sampling** | Same. |

### Realistic expectation for _this_ project

A well-instanced Three.js universe is usually bottlenecked by (a) draw
calls/CPU and (b) transparent-glow **overdraw**. Instancing fixes (a) in
**both** APIs; overdraw is a fillrate problem WebGPU doesn't magically fix. So:

- For the **fragment-heavy** effects (R2): WebGPU ≈ WebGL2.
- For **pushing the star-count ceiling** (R1) and **data-heavy shaders** (R3):
  WebGPU's compute + storage buffers are a real, up-to-order-of-magnitude
  headroom win — _if_ we lean on them.
- Honest summary: expect **comparable-to-~2–3× on CPU-bound frames** plus **new
  capabilities** (compute culling, GPU particles), not a uniform 3× on
  everything.

### The resolution: with Three.js you don't actually have to choose

This is the key point that **changes the first draft's recommendation.** Three.js
exposes **two renderers from one scene graph**:

- `WebGLRenderer` — the classic, rock-solid path.
- `WebGPURenderer` — newer, uses **TSL** (node shaders transpiled to WGSL _or_
  GLSL), and **automatically falls back to WebGL2 when WebGPU is absent.**

Build on `WebGPURenderer` + TSL and the **compatibility cost is ~0**: WebGPU
long-tail users transparently run the WebGL2 path from the _same_ code. We get
WebGPU's ceiling where it exists and lose almost no one. That is exactly your
"lose ~5% compat for a big gain → no-brainer" case — except the dual renderer
means we barely lose the 5%.

**Caveat (honest):** `WebGPURenderer` + TSL is younger than `WebGLRenderer` and
still evolving; compute-only features run **only** on the real WebGPU path (the
WebGL2 fallback has no compute). So design the **core** to the WebGL2 capability
set and treat compute-driven extras (e.g. GPU particle culling beyond some star
count) as **progressive enhancement** on the WebGPU path. Since this work is
scheduled later, that path will be more mature by the time we build it.

### Verdict (revised)

**Build on Three.js `WebGPURenderer` with automatic WebGL2 fallback; author
shaders in TSL.** Core features target the WebGL2 capability set; compute-based
scaling is a WebGPU-only enhancement layered on top. Re-check WebGPU coverage on
caniuse when work actually starts.

> This supersedes the first draft's "WebGL2-only baseline." WebGL2-only remains a
> perfectly safe fallback if `WebGPURenderer`/TSL churn ever feels too
> bleeding-edge — nothing in R1–R4 _requires_ WebGPU.

## 5. Library: Three.js (confirmed)

Full 3D + sphere planets + a tilt/orbit camera + raycast picking is squarely
Three.js territory; hand-rolling it on raw WebGL/WebGPU would be a large, needless
detour. Decision: **Three.js**, on the `WebGPURenderer` (WebGL2 fallback) path
with **TSL** shaders (§4).

| Considered | Verdict |
| ---------- | ------- |
| **Three.js** | **Chosen.** 3D scene graph, cameras, raycasting, sphere geometry, materials/lighting, instanced meshes, post-processing, and the dual WebGPU/WebGL renderer. |
| twgl / regl (thin WebGL2) | Rejected for full 3D — too low-level; we'd reimplement a 3D engine. (Would have been the pick had we stayed 2D.) |
| PixiJS v8 | Rejected — 2D-focused. |
| Raw WebGL / WebGPU | Rejected — boilerplate, no payoff over Three.js. |

Three.js takes over the **render loop and scene** for the 3D tiers. The engine
ECS world stays the source of truth for entities + data; a thin sync layer
mirrors on-screen ECS entities into Three.js objects (or drives instanced
buffers). The engine `Renderer<TCtx>` seam still hosts this as one `render()`
implementation, so generation/sim stay untouched.

## 6. Going full 3D (the chosen path)

### 6A. What changes vs what survives

The physics-property layer is geometry-agnostic and **survives untouched**; the
coordinate + view layers are rewritten.

| Layer | Change for full 3D |
| ----- | ------------------ |
| Generation (`src/generation/*`) | Add a **Z** axis: sector hashing → 3D, cosmic web → 3D field, galaxy density → a disk with **thickness + inclination** (thin disk + bulge + sparse halo, §10). Star / planet / black-hole **properties stay exactly as-is**. |
| Orbits (`src/sim/orbits.ts`) | Add **inclination** + **longitude of ascending node** (2 elements); project the existing ellipse into a tilted 3D plane. Small change (see §6C). |
| Position | Engine `PositionDef` is 2D; add a Z (3D position store or a parallel component). Camera/render read 3D. |
| Camera (`src/camera/*`) | Replace 2D pan/zoom with a Three.js **orbit + pan + tilt** (optionally free-fly) camera. |
| LOD (`src/lod/tier.ts`) | Tier selection by **camera distance to target**, not 2D `zoom` (px/AU). |
| Picking (`src/pick.ts`) | Screen→world **raycast** (Three.js `Raycaster`) instead of 2D unproject. |
| Floating origin (`src/main.ts`) | Still required for float precision; becomes a **3D** camera-relative rebase (keep the camera near scene origin, offset the world). |
| HUD (grid, scale bar, coords, reticle, labels) | Project 3D → screen for labels/reticle; the grid becomes a 3D reference plane; the scale bar reads camera distance. |
| Renderers (`src/render/draw-*`) | Re-expressed as Three.js scene content (instanced stars, sphere planets, glow sprites, shader materials). |

**Untouched:** all per-body physics derivations, naming, inspector, persistence,
time controls, and determinism.

### 6B. The "fake sphere" trick is still useful in 3D

Even in a real-3D scene, distant stars and faint galaxies should **not** be real
geometry — they stay **billboarded impostor sprites** (a camera-facing quad whose
shader fakes a glowing sphere/corona). Real sphere meshes are reserved for the
**near** bodies (the focused star + its planets/moons). This keeps the star count
cheap exactly like the 2D LOD does today: impostors far away, real spheres up
close.

### 6C. Orbital planes — you're (mostly) right

Your intuition is correct: planets are **not** chaotically inclined. They form
from a flattened protoplanetary disk, so a system's planets share approximately
**one plane** with only a few degrees of mutual scatter (in our Solar System most
are within ~1–3° of the ecliptic; Mercury is the outlier near ~7°). So:

- Model each **system** with its own disk-plane orientation (a tilt + node vs the
  world axes), and give each planet a **small** random inclination (a few degrees)
  about that plane. Not full 3D chaos — cheap and realistic.
- The system plane itself can be randomly oriented (it need not align to the
  galaxy plane), which is what makes a 3D fly-around look varied and alive.
- **"View as flat" option:** because a system is near-coplanar, a render toggle
  can flatten it — snap the camera top-down and/or zero the inclinations at
  render time — restoring the clean 2D reading. Cheap to provide; a good default
  for users who find the tilt disorienting.

One correction to the assumption: **between** systems there is no shared plane —
each system's disk points a different way — and moons/rings add their own local
planes. So "mostly coplanar" holds **within** a system, not across the galaxy.

## 7. Staged roadmap

Each stage is independently shippable and preserves the LOD invariant (bounded
on-screen work) and determinism. R1 + R2 are front-loaded per your priority; a
minimal 3D scene (Stage 0) is the unavoidable foundation they sit in. Checkboxes
fill as work lands.

### Stage 0 — Three.js foundation

> Status (2026-07-01): landed behind a runtime **Renderer** toggle in the options
> menu (`renderBackend`, default **Canvas 2D**). The Three.js backend is
> lazy-loaded (dynamic import → separate ~730 kB chunk) so Canvas 2D sessions do
> not download it. Only the **system tier** renders through Three so far (bodies
> as flat discs); the other tiers and the DOM/Preact HUD stay on Canvas 2D. Green
> on build + 222 tests + lint. Browser verification (which backend initialises,
> body alignment, seamless toggle) is Pierre's per AGENTS.md.

- [x] Stand up a Three.js `WebGPURenderer` (WebGL2 fallback) drawing into a
      dedicated canvas. (Which backend actually initialises is logged to the
      console for in-browser confirmation.)
- [x] Reproduce the current system-tier view as a flat plane seen top-down
      (orthographic camera matching the Canvas 2D `worldToView`, y-down) so
      nothing visibly regresses. The interactive **3D orbit + pan + tilt camera**
      is deferred to Stage 3 (true-3D plumbing).
- [x] Host it behind the engine `Renderer<TCtx>` seam; keep the DOM/Preact HUD.
- [x] Float-precision contract: feed Three.js render-origin-relative coords, as
      today.

Deferred within Stage 0 (do as the migration continues): render body **strokes**
(star outline, black-hole accretion ring — currently fill-only discs); move the
remaining tiers (star / galaxy / galaxy-field / universe) into the Three path
(Stage 1).

### Stage 1 — Instanced 3D star field (R1)

- [ ] Stars as **instanced billboard impostors** fed from the sector cache
      (position + colour buffers); one draw call for the field.
- [ ] Galaxy / galaxy-field / universe glow tiers as instanced additive sprites
      or a density shader.
- [ ] Re-tune LOD: show far more individual stars before the aggregate-glow
      switch (GPU budget is bigger, still bounded).

### Stage 2 — Shader effects (R2)

- [ ] Star corona / chromatic glow / subtle flicker, colour from blackbody T.
- [ ] Black-hole accretion disk (animated) + photon ring; optional screen-space
      gravitational lensing as a post-process. Driven by existing
      mass/spin/accretion data.
- [ ] Cosmic-web / nebula volumetric-ish additive noise from `cosmicDensity`.

### Stage 3 — True 3D plumbing

- [ ] Add **Z** to generation (sectors, cosmic web, galaxy disk thickness +
      inclination); keep determinism (append draws, never reorder).
- [ ] **Inclined orbits** (§6C): per-system disk plane + small per-planet
      inclination in `sim/orbits.ts`.
- [ ] Distance-based LOD, raycast picking, 3D floating-origin rebase; unlock
      full camera tilt / fly.
- [ ] **"View as flat"** toggle (camera top-down / inclinations zeroed).

### Stage 4 — Sphere planets + procedural textures (R3)

- [ ] Real sphere meshes for **near** bodies; TSL surface shader from data
      (type, temp → ice/molten, composition, atmosphere cloud layer, oblateness
      squash, rings, axial tilt, tidal-lock terminator) + axial rotation.
- [ ] Surface a rendered thumbnail in the inspector.
- [ ] Cache per-body textures/material (keyed by body identity).

### Stage 5 — WebGPU compute enhancements _(progressive, optional)_

- [ ] GPU frustum/LOD culling + GPU particle star field to push the star-count
      ceiling on the **WebGPU path** only; WebGL2 keeps the CPU-instanced path.

## 8. Invariants to preserve (do not regress)

- **Determinism**: generation stays a pure function of the seed; rendering never
  feeds back into generation.
- **Bounded on-screen work** at every tier (the whole point of LOD) — a GPU
  budget is bigger, not infinite.
- **Floating origin / precision**: GPU buffers receive render-origin-relative
  coordinates; never raw galaxy-scale absolutes.
- **Layer direction**: generation → sim → render stays one-way. New GPU code
  lives in `src/render/` behind the engine `Renderer` seam.
- **HUD split**: panels / controls stay **DOM/Preact + signals**; body **labels**
  (planet / star names) move **into the renderer** as world-space text that
  tracks bodies in 3D. The canvas/ECS loop stays imperative. (Fall back to DOM
  labels only if a renderer-side label proves impractical.)
- **Engine layering**: Three.js owns the 3D scene + loop, but stays behind the
  engine `Renderer<TCtx>` seam and reads the ECS world as the source of truth —
  generation/sim never import Three.js.

## 9. Open questions

**All resolved — see §10.** New questions that surface when work starts get
appended here.

## 10. Decisions log

| Date | Question | Decision |
| ---- | -------- | -------- |
| 2026-06-30 | 3D scope | **Full 3D** — pan / tilt / orbit camera, rotating star + planet spheres, a Z axis, gently-inclined orbits, plus a "view as flat" option. |
| 2026-06-30 | First priority | **R1 + R2 first** (many stars, shader fx); **R3** (planet textures) after. |
| 2026-06-30 | Library | **Three.js** (full 3D). |
| 2026-06-30 | WebGPU vs WebGL2 | **Three.js `WebGPURenderer` with automatic WebGL2 fallback**, shaders in TSL. Core targets the WebGL2 capability set; compute is a WebGPU-only enhancement. Compatibility cost ≈ 0 via the fallback. |
| 2026-06-30 | Timing | **Approved design, scheduled later** — lands after the realism/data session. |
| 2026-06-30 | Axial rotation / tilt on near bodies | **Yes, intended — but post-V1.** Spheres can render statically first; visible rotation + tilt is a follow-up. |
| 2026-06-30 | WebGPU risk | **WebGPU-first accepted** — `WebGPURenderer` is the primary path, WebGL2 the automatic fallback. |
| 2026-06-30 | HUD vs labels | **HUD panels stay in the DOM; body labels move into the renderer** (world-space, tracking bodies); DOM-label fallback only if impractical. |
| 2026-06-30 | Galaxy disk thickness | **Hybrid (Option C):** astrophysically thin disk + a prominent spheroidal **bulge** (carries the 3D read) + a sparse halo, with one tunable `GALAXY_DISK_PUFF` knob (default near-realistic); morphology-aware (thin spiral/barred, rounder elliptical/dwarf). The per-star Z draw is appended **last** in star sampling to keep determinism. |
