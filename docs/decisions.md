# Decisions

Next ID: D9

## D1 The universe is at real physical scale

Distances and sizes are physically real: AU within systems, light-years
between stars, Milky-Way-sized galaxies (`GALAXY_CELL_LY` cells). Usability
comes from navigation and rendering — accelerating zoom, LOD tiers that collapse
empty space, the floating origin, body-size floors — not from a compressed
universe. Density fields only modulate where stars are placed; star positions
are never remapped.

Rejected: a toy scale (stars hundreds of AU apart), and a radial fisheye
position remap (`scaleCompression`, tried and scrapped).

## D2 Absolute float64 coordinates, no hierarchical addressing

World positions are absolute AU in float64, and sector and galaxy-cell indices
are exact integers. At the far edge (~10¹³ AU) float64 still resolves ~10⁻³ AU,
which is irrelevant for navigation. Render and interaction precision come from
the floating origin (`camera/origin.ts`, the star-local render origin), not
from the addressing scheme.

Rejected: nested universe → galaxy → sector addressing with per-level
rebasing; it adds a layer while every coordinate already fits exactly.

## D3 Three.js `three/webgpu` is the only renderer

Every tier renders with Three.js `WebGPURenderer` and TSL shaders, which falls
back to WebGL2 automatically. Fragment-heavy effects run at about the same speed
on both APIs, so only compute (GPU culling, GPU particles) is WebGPU-only, and
that stays an optional enhancement: every shader must work on the WebGL2
fallback. If Three cannot start, the page shows a notice; there is no 2D
fallback.

Rejected: plain `WebGLRenderer`, PixiJS (2D only), raw WebGL / WebGPU, and
keeping the old Canvas 2D renderer as a fallback (it doubled every tier's render
code and blocked moving bodies to `Position3DDef`).

## D4 Generation keeps its own maths and noise

`generation/galaxies.ts` (`smoothstep`, the cosmic-web value noise) and
`generation/hash.ts` stay bit-identical: any numeric change reshuffles every
existing universe for its seed. Engine maths and noise are for new generated or
visual features only.

Rejected: switching generation to the engine `math` / `noise` modules.

## D5 Engine features deliberately not used

- **Entity templates for `spawnSector`:** every component value is per-body
  data, so a template would be empty and all data would move into string-keyed,
  untyped overrides, losing the typed `store.set` checks.
- **`HashGrid2D` for picking:** streamed body counts at the system tier are
  small; a linear scan is enough.
- **The `camera-3d` orbit rig:** the camera is anchored to the focused system's
  tilted orbital plane (`planeBasis`), which the generic yaw / pitch `OrbitRig`
  does not model.

## D6 Cubic 4 ly sectors and realistic star density

Sectors are 4 ly cubes. A Node benchmark of Poisson-count sampling over a 20 ly
star-tier reach measured, per full reach: 1 ly cubes 43 ms at a galaxy core,
2 ly 18 ms, 4 ly 15 ms (1.0 ms in the disk, 0.3 ms in a void), 8 ly 27 ms; 4 ly
needs 804 cubes, which fits the sector cache. Star density is realistic in
shape and calibrated so the azimuth-averaged mid-plane 25,000 ly from a
galaxy's centre holds 0.004 stars / ly³ (`STAR_DENSITY_PEAK`), times a
`STAR_DENSITY_SCALE` knob (default 1; ×10 still fills a core reach in ~40
budgeted frames).

Rejected: 1 ly cubes (too many near-empty sectors), and keeping the former flat
model's apparent density (far denser than real).

## D7 Zoom-to frames what orbits a body; Lock never zooms

Zoom-to frames the selected body with its satellites: a star frames its
outermost planet's apoapsis, a planet its outermost moon's apoapsis, a body
without satellites `DISC_FRAME_FACTOR` × its disc radius
(`camera/framing.ts`). A planet is not framed by its own orbit, which would
re-frame the whole system and duplicate the star's Zoom-to. Lock keeps the
body centred at the current zoom and never zooms; the two compose. Only planets
and moons lock, since stars, galaxies and black holes do not move.

A body framing (Zoom-to, bookmark Inspect, a star-tier click) never puts the
camera beyond `BODY_FRAME_MAX_DISTANCE_AU` (90% of the distance at which the
view enters the system tier), because body selections and pending bookmarks
only live at the system tier. A system wider than that view (O / B stars,
heavy black holes) is framed to its edge rather than whole.

Rejected: keeping body selections alive outside the system tier (the bodies
despawn once the cross-fade completes, and the system is mostly faded by then).

Rejected: a combined "lock and frame" button (surprising).

## D8 Planet surface effects are always on and tuned in the planet lab

Surfaces, clouds and atmosphere glow have no settings toggle: they are cheap,
baked once per planet. Their looks are `src/config/render.ts` knobs that Pierre
tunes in the planet lab, because a look is judged by eye and an agent's
code-then-browser loop was too slow.

Rejected: per-effect settings switches.
