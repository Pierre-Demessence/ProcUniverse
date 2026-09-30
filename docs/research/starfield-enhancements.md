# Starfield enhancements — options and references

Candidate next steps for the system-view background sky, with how comparable
space visualisers approach the same problem. This is design context: picked-up
items get a plan under [plans/](../plans/) and are tracked as one-liners in the
[roadmap](../roadmap.md).

## Current state

The sky is a camera-locked dome (`src/render/three/starfield.ts`):

- ~10⁴–10⁵ instanced star sprites, rejection-sampled per galaxy, with a skewed
  brightness distribution, brightness-linked size, bloom halos on the brightest
  tail and per-star colours.
- A baked sky-structure map (`src/render/three/sky-structure.ts`: wavy band,
  star clouds, dust lanes, bulge toward the core) that drives both star
  density and the TSL band-glow shader, plus a few open clusters.
- Intergalactic void: a thin uniform star field, no band.
- Regenerated per galaxy and per ~50,000 AU position bucket; cached.

Shipped plans: [background-starfield.md](../plans/done/background-starfield.md),
[starfield-falloff.md](../plans/done/starfield-falloff.md),
[starfield-star-realism.md](../plans/done/starfield-star-realism.md),
[starfield-band-structure.md](../plans/done/starfield-band-structure.md).

## Why a skybox is physically right inside a system

Parallax across a system is negligible. The nearest star is ~270,000 AU away; a
system is ~100 AU across, so crossing it shifts the nearest star by
~100 / 270,000 rad ≈ 0.02° — under one pixel at a 50° FOV on a 1080p screen.
Placing sky stars at their true distance therefore changes nothing visible
while the camera stays inside a system. The depth of a still sky comes from
layering (bright star clouds behind dark dust) and a steep brightness
distribution, both already implemented.

True positions matter only when the camera moves **between** stars — in
ProcUniverse, when zooming out from the system tier to the sector tier.

## How other visualisers do it

| Tool | Approach |
| ---- | -------- |
| SpaceEngine | Hybrid: nearby procedural + catalogue stars are real 3D points (brightness from luminosity and distance); the far galaxy is a procedurally rendered background, refreshed as the camera travels. |
| Elite Dangerous | Hybrid: the nearest stars of its 400-billion-star galaxy are real points; the rest of the sky is a skybox generated from the galaxy model and rebuilt after each jump. |
| Celestia, Gaia Sky | Catalogue-driven: every star is a real point at its true position, streamed by distance (Gaia Sky uses an octree LOD over millions of stars). Accurate but costly. |
| No Man's Sky, Outer Wilds | Skybox only (stylised); players never travel between stars in real space. |

ProcUniverse already generates its neighbours deterministically, so the hybrid
model is the natural fit.

## Candidate enhancements

### 1. Hybrid sky — real neighbours as the near stars

Draw the nearest generated star systems as real sky stars, in their true
directions, over the statistical dome.

- **Selection:** the N nearest systems (or all within radius R, e.g. a few
  sectors) from the sector cache / star-only records around the focus.
- **Brightness:** from each star's luminosity and distance (inverse square →
  an apparent-magnitude-like scale mapped onto the existing
  `starBrightness` / `starIntensity` / `starScale` range); colour from its
  blackbody colour. The nearest few would be the brightest stars in the sky,
  as in reality.
- **Dome interplay:** the dome stays as the unresolved background; real stars
  are an overlay, so no need to punch holes in it. Optionally suppress dome
  stars brighter than the faintest real neighbour so the brightest sky stars
  are always real ones.
- **Payoff:** a seamless system → sector zoom (sky stars become map stars
  instead of swapping), and every bright star is a place you can go (pickable
  / labelled later).
- **Blocker — flat galaxy:** systems currently sit on the galaxy plane (z = 0
  at galaxy scale), so every neighbour would land exactly on the band's centre
  line. Needs per-system out-of-plane offsets — either the 3D-galaxy work
  ([rendering-backend.md](../plans/rendering-backend.md) Stage 3) or a
  deterministic, visual-only z jitter scaled to the disk thickness.
- **Cost:** needs neighbour star records without full planet generation (see
  the star-tier generation performance item in the roadmap).
- **History:** the original starfield decision
  ([system-visuals.md](../plans/system-visuals.md) decisions log) chose a
  procedural dome over "rendering every real neighbour"; the hybrid keeps the
  dome and adds only the nearest few hundred.

### 2. Intergalactic-void sky

Between galaxies you would see almost no individual stars — only galaxies.

- Replace the uniform void star field with a near-empty sky: a handful of
  faint foreground stars at most.
- Draw other galaxies as smudges in their true directions, sized by angular
  diameter and shaped by their type / orientation (reuse `galaxy-sprites.ts`
  population colours); the nearest galaxy (the one just left) as a large,
  bright, structured disk.

### 3. Other galaxies seen from inside a galaxy

Even inside a disk, the nearest large neighbour galaxies are visible as faint
smudges away from the band (like Andromeda from Earth). Same data as item 2,
drawn only where not hidden behind the band / dust.

### 4. Coloured nebulae

Add emission (red H-alpha) and reflection (blue) nebulae along the band as a
new sky-structure channel. Tie emission nebulae to the open clusters (young
stars ionise their birth clouds) so the two appear together. Dust lanes can
occlude them.

### 5. Position-aware bulge and band

Scale the bulge's angular size and brightness with distance to the galaxy
core: near the core it fills a large part of the sky; at the rim the band is
faint and one side is much brighter than the other. Uses the camera-to-core
distance already computed for the toward-core direction.

### 6. Galaxy-type awareness

An elliptical host has no disk: no band or dust, just a smooth glow brightening
toward the core. Irregular hosts: patchy with no clear plane. Depends on galaxy
types and the 3D-galaxy model (roadmap: "starfield realism" follow-on).

### 7. Rebuild off the main thread

A starfield rebuild now costs ~70 ms of galaxy sampling plus ~30 ms of
sky-structure bake and ~15 ms of map lookups. Move generation to a worker or
spread it over frames so crossing a 50,000 AU bucket never hitches.

### 8. Exposure adaptation (optional)

Dim the sky when a bright body (the star, a sunlit planet) fills the view, as
a camera or eye would. More realistic, but it hides the sky exactly when it is
most visible in screenshots; if added, keep it subtle and optional.

### Not recommended

- **Twinkling:** caused by atmospheric turbulence; wrong in space.
- **Rendering every star at true distance:** no visible gain inside a system
  (see above) at a large cost.
