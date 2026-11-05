# B44 Review fixes — defects found in the November 2026 project review

Goal: fix what the whole-project review found broken — logic, design, formula
and documentation defects in what already ships. Nothing here is a new
feature.

Status: plan written; B44.1–B44.5 in progress on the review-fixes pull
request. Items marked **Needs you** wait for Pierre's call.

How the review was done: every source file was read (core logic directly, the
Three.js renderer and the UI by two independent review passes), every finding
was re-checked against the code, and the ones with numbers were measured with
throwaway scripts (not committed). Browser behaviour was not exercised; the
items that need an eye in the browser say so.

## Findings

Severity: **high** = a shipped feature is broken or the project's own safety
net is off; **medium** = wrong results or visuals a player will meet;
**low** = cosmetic, rare or documentation.

### Blocking

- **F1 (high) The determinism tests are machine-dependent, so CI has been red
  since 63a2c3e and itch.io is stuck at 052bd7e (30 Sept).** The two
  "regenerates … byte-identically" tests (`src/generation/universe.test.ts`)
  hash every digit of every generated number. `Math.sin`, `exp`, `pow`, `cbrt`
  … may differ in the last bit between JS engines, versions and CPUs, so the
  pin made on one machine cannot match CI. Reproduced: nudging those functions
  by one unit in the last place gives the same signature as CI (different hash,
  length off by a few characters, identical star / planet / moon counts). The
  itch.io publish only runs after a green CI on `main`, so every push since
  30 Sept (the whole 3D work) is unpublished, and while CI is red "for a known
  reason" a real determinism break would go unnoticed.
  Fix: hash numbers rounded to a fixed number of significant digits (integers
  exact). **Needs you:** once CI is green, the next push to `main` publishes
  the 3D universe; B1.7 (version-1 saves, AC8) is not done, so players' saved
  bookmarks would point at stars that no longer exist (no crash: they never
  resolve). Merge after B1.7, or accept that.

### Selection and interaction

- **F2 (high) Zoom-to / Inspect / star click can land outside the system tier,
  which drops the selection.** `frameZoom` puts the camera ~3× the framed extent
  away (margin 1.4, 50° FOV). The system tier ends at 300 AU (375 AU leaving,
  240 AU entering, `TIER_HYSTERESIS`), body selections are cleared outside it
  (`render-systems.ts` reticle step) and pending bookmarks only resolve inside
  it. A star whose outermost apoapsis exceeds ~125 AU (Zoom-to) or ~80 AU (star
  click / Inspect) is never selected: measured, 10 of 15 O stars and 19 of 223
  B stars near a core — the brightest, labelled stars people click (made worse
  by F7). Black holes above ~8×10⁸ M☉ too.
  Fix: cap body framing at a camera distance inside the system tier.
- **F3 (high) An origin move respawns every streamed body with new entity ids,
  so the selection and lock die** (`world-systems.ts` origin rebase →
  `streamer.clear()`). Inspect on a bookmark whose body is already streamed but
  belongs to another system, or a star click inside the cross-fade band,
  selects the body and loses it on the next frame. Same root as B8, which only
  mentioned a possible lock release and a hitch.
  Fix: shift live entities by the origin delta instead of respawning (delivers
  B8, and most of F23).
- **F4 (medium) Wheel zoom treats every wheel event as a full notch**
  (`camera-controller.ts` `onWheel`): a trackpad's ~60 small events per second
  (with the streak ramp up to ×2.5 each) cross most of the 10²¹ zoom range in
  one swipe; `deltaY = 0` (horizontal swipe, Shift+wheel) always zooms out;
  `deltaMode` is ignored. **Needs you:** a trackpad check.
- **F11 (medium) The reference plane snaps when the focused system changes
  inside the cross-fade band.** `referencePlaneNormal` blends in
  `focusedSystem.diskNormal` with no easing (`render-systems.ts`
  `frameReferenceNormal`). Wheel-zooming toward a neighbour star while within
  ~900 AU of the current one moves the focus across; when the neighbour becomes
  the nearest (≈7 notches, blend ≈ 0.3) the plane jumps by (1 − blend) of the
  angle between the two disks (~60° for disks 90° apart) in one frame.
- **F12 (low) `planeBasis` is singular at N = −ẑ.** The minimal rotation from
  +ẑ has no continuous frame there, so a swing passing near −ẑ spins the
  in-plane axes: a 115° slerp passing 1° from −ẑ turns u by 356°, 63° in one 1%
  step. Paths to the home galaxy's +ẑ are meridians and stay smooth; swings
  between other galaxies' normals can hit it. Contradicts the "never snaps"
  invariant.
- **F13 (medium) The 2D overlay ignores the device pixel ratio.** The canvas is
  device-pixel sized but every font (9–12 px), label gap, reticle size, the
  scale-bar target, `PICK_PX` and the label thresholds are device pixels, so at
  DPR 2 (Retina, 4K at 200%) text is 4.5–6 CSS px and the pick radius 7 CSS px.
  `CLICK_SLOP_PX` is compared in CSS px, so the two disagree.
  **Needs you:** whether sprite / body-floor pixel sizes should scale too.
- **F16 (medium) Nearly invisible star sprites still capture picks and wheel
  targets.** `StarSpriteLayer.fill` keeps any sprite with weight > 0 (6×10⁻⁵ at
  101 AU) and `nearestOnScreen` ignores weight, so `zoomTargetAt` can fling the
  focus thousands of AU toward a star you cannot see (and then F11).
- **F19 (low) `pickAt` hits meshes beyond the far plane** (neighbour stars stay
  `visible` at blend 0; the raycaster has no far limit), so a click can select
  an undrawn star.

### Physics and formulas

- **F5 (medium) Every habitable-zone planet reads "Habitable: Yes · ice" and
  no ocean is ever drawn in the zone.** `waterState` uses the equilibrium
  temperature, which across the whole zone (0.95–1.37 √L AU, albedo 0.3) is
  217.6–261.2 K; Earth itself would be ice. Liquid only occurs inside the inner
  edge. The inspector's Surface row already adds greenhouse warming.
  Fix: derive it from the greenhouse-corrected surface temperature; no liquid
  without an atmosphere. Changes generated data, not RNG draws.
- **F6 (medium) Planet "Inclination" is measured against the galactic plane.**
  `planeToElements` returns i against world +z, but each system disk points in a
  random direction: shown values average ~90° and half read above 90° (which
  reads as retrograde). The tooltip says "relative to the reference plane".
  Fix: store and show the tilt from the system's own disk.
- **F7 (medium) Hot stars are thousands of times too common.**
  `sampleStellarMass` draws the Kroupa *initial* mass function and `sampleStar`
  always draws an age below the lifetime, so no star has ever died. Measured
  (activity 0.5, 2×10⁶ draws): O 0.188 %, B 3.25 %, A 2.86 %, F 2.70 %,
  G 2.65 %, K 11.1 %, M 77.3 %, against the table in `physics.md`
  (O 0.00003 %, B 0.12 %, A 0.61 %, …): O ~6000×, B ~27× too common; in arms
  (activity 1) O + B is ~10 %. They dominate the star tier's brightness, spikes
  and labels. **Needs you:** a present-day correction (e.g. a star is kept only
  with probability min(1, lifetime / universe age), the rest become future
  remnants, B33) reshuffles every universe.
- **F8 (medium) Tidally locked planets do not keep one face to their star.**
  Their spin period is set to the orbital period but the spin axis keeps the
  isotropic obliquity draw (median 90°), so the surface slides under the
  terminator (`body-passes.ts` `orientPlanet`). Locking also damps obliquity.
  **Needs you:** set obliquity to 0 when locked (changes moon planes and the
  displayed tilt, not the draw order), or only fix it in the renderer.
- **F9 (low) Star limb darkening runs the wrong way.**
  `starSurfaceParams` raises the linear coefficient u with temperature
  (0.5 → 0.75); in visible light u falls with temperature (~0.8 at 3500 K,
  ~0.6 solar, ~0.45 at 10 000 K).
- **F10 (low) A galaxy's mean stellar age can exceed the universe's age**
  (`meanStellarAge` is a fixed 10 / 6 / 5 Gyr; the universe is 8–18 Gyr per
  seed, so ~20 % of seeds).
- **F31 (low) Planet mutual inclinations use the drawn planet count, not the
  number placed** (`generateSystem` multiplicity), so a system cut short by its
  disk edge is treated as crowded and flat.

### Visuals

- **F14 (medium) A pile of overlapping planet labels on the first screen.** At
  blend 0 the far plane comes from the nearest *streamed* star
  (`focusedSystemReach`), and `drawBodyLabels` has no size or reach filter for
  planets. The start view looks at the home black hole, tens of thousands of AU
  from any star, so neighbouring systems fall inside the far plane and all their
  labels land on one pixel (about a third of seeds in a 200-seed simulation).
- **F15 (low) The black hole's label disappears past 100 AU while its sphere
  stays.** Meshes exempt black holes from the reach cull (`ALWAYS`) but the
  label filter in `render-systems.ts` does not. The reach cull exists in three
  hand-written copies (meshes, labels, orbit rings); make it one predicate.
- **F17 (low) Rings are drawn before clouds and the atmosphere glow.** Rings
  keep `renderOrder` 0 (transparent, no depth write) while clouds are 1 and the
  glow 2, and three.js sorts transparents by `renderOrder` first, so clouds
  cover the near ring arc and the glow paints over rings.
  **Needs you:** a browser look.
- **F18 (low) The focused star is labelled twice (4 px apart) for blend
  0.8–1**, once as a body and once as a bright sprite.

### Saving and page lifecycle

- **F20 (medium) The session (view, clock, speed) is saved only in a
  `beforeunload` teardown that also destroys the app** (`index.html`,
  `main.ts`). A discarded (Memory Saver), killed or crashed tab never saves,
  and a page restored from the back/forward cache comes back with no loop and
  no panels. Fix: save on `visibilitychange` / `pagehide`; do not tear down on
  unload. **Needs you:** a Back-button check in the browser.
- **F21 (low) Two open tabs overwrite each other's bookmarks** (last writer
  wins).
- **F22 (low) Reloading while flattened saves tilt 0** (`tilt` returns the
  effective tilt), so the prior 3D angle is lost.

### Performance

- **F23 (medium) Body mesh pools double on a full respawn.** The engine
  `Scene3DRenderer` creates new objects before removing unseen ones, so a
  same-frame clear + respawn takes fresh pool entries (new node materials,
  1024 × 512 half-float surface and cloud bakes, ~5.6 MB each) while the old
  ones stay allocated in the free list. F3's fix removes the respawn on origin
  moves.
- **F24 (low) Instance buffers are uploaded whole every frame** (no update
  ranges; capacity only grows), plus per-frame allocations in the body passes.

### Minor, design and docs

- **F25 (low)** `distance.ts` `threeSigFigs` hits `toLocaleString`'s default
  three fraction digits: 0.00176 AU shows "0.002 AU".
- **F26 (low)** The universe cannot be bookmarked (its panel has no footer)
  although `features.md` says so; the bookmark list ignores the naming style.
- **F27 (low)** Bookmarks, the location tree and pending bookmarks identify a
  body by catalogue name only, which `isSameSystem` admits can repeat.
- **F28 (low)** `visibleSectors` has no padding for a system's extent: an outer
  planet across a sector face from its own star despawns with its star when the
  view zooms in on it.
- **F29 (low)** The frame delta is not clamped, so the sim clock jumps by the
  whole time a tab spent in the background (30 min at the default speed ≈ 25
  sim-years). May be intended.
- **F30 (low)** Generation depends on the engine's `makeSeededRng`,
  `randomInt` and `lerp` although D4 says generation keeps its own maths; an
  engine change would reshuffle every universe, unnoticed while F1 stays red.
- **F32 (low)** Small ones: `starSatelliteApoapsis` matches planets by x, y
  only; the body reticle uses the focus `zoom` instead of `pxPerAu` at the
  body's depth; no `pointercancel` handling in the controller; an empty click at
  the star, galaxy and universe tiers does not dismiss a selection.
- **F33 (low) Docs drift:** `features.md` (no renderer option, no Zoom-to in
  the bookmark panel, universe bookmarks); `physics.md` (class shares vs the
  generator, the first orbit is the inner edge × a ratio, the 0.95 / 1.37 AU
  bounds are Kasting 1993); "bilinear" cosmic web (trilinear); the
  `StarPhysical.age` comment (per-seed 8–18 Gyr); `package.json` "2D".

Checked and found correct: Kepler orbits and the eccentric-anomaly solver,
`planeToElements` / `tiltNormal`, the IMF sampler maths, mass–luminosity /
radius / temperature, blackbody colours, frost line, habitable-zone and
equilibrium-temperature formulas, the Forecaster mass–radius law, black-hole
formulas (ISCO, Hawking, Eddington, photon sphere), the star-density
calibration (0.004 stars / ly³ at 25 000 ly), the thinning bound, the pan basis
against the render camera, entity-id recycling, and the planet lab staying out
of the app and the build.

## Checklist

Each item keeps `npm run build`, `npm test` and `npm run lint` green, updates
the `AGENTS.md` invariants, `docs/codebase.md` and `docs/features.md` it makes
stale, and trims backlog entries it delivers; the last item deletes B44 and
this plan.

### B44.1 Machine-independent determinism tests (F1)

- [x] Hash rounded numbers in both fingerprint tests; re-pin. Measured with
      every transcendental call perturbed by up to 64 units in the last place
      (25 patterns each): 10 significant digits flipped the fingerprint, 9 once,
      8 and fewer never; 7 kept for margin.

Visible after: CI green; nothing in the app.
Needs you: the merge-to-`main` timing (F1).

### B44.2 Keep streamed bodies across origin moves (F3, F23; delivers B8)

- [ ] `SystemStreamer` shifts live entities (positions and orbit centres) by
      the origin delta instead of the origin rebase clearing and respawning.
- [ ] Tests: ids survive a rebase, positions shift exactly.

Visible after: Inspect / star clicks keep their selection; no respawn hitch
when the focus moves to another star.
Needs you: browser check of Inspect on a nearby bookmark and of a lock while
the focus changes star (at the end).

### B44.3 Zoom-to and Inspect stay in the system view (F2)

- [ ] Cap body framing at a camera distance inside the system tier; D7 updated.

Visible after: clicking a bright O / B star selects it; very wide systems
frame to the edge of the system view.

### B44.4 Water state and inclination (F5, F6)

- [ ] `waterState` from the greenhouse-corrected surface temperature.
- [ ] Store each planet's tilt from its disk; the inspector shows it.

Visible after: Earth-like planets in the habitable zone read "liquid" and show
oceans; inclinations read a few degrees.
Needs you: lab look at the planets that gain or lose oceans (B12).

### B44.5 Wheel and trackpad zoom (F4)

- [ ] Zoom proportional to the wheel delta (`deltaMode` aware), no zoom on
      horizontal-only events, streak grown by notch-equivalents.

Needs you: trackpad and mouse feel.

### B44.6 Overlay pixel ratio (F13)

- [ ] Fonts, label gaps, reticles, scale bar and pick tolerances in CSS px.

### B44.7 Render fixes (F14, F15, F16, F17, F18, F19, F24)

- [ ] Far plane and planet labels bounded at blend 0; one shared reach
      predicate; faded sprites not pickable; ring render order; one focused
      star label; raycaster far limit; buffer update ranges.

### B44.8 Camera smoothness (F11, F12)

- [ ] Ease the system normal on a focus change; a basis with no singularity on
      the swing path.

### B44.9 Saving (F20, F21, F22)

- [ ] Save on `visibilitychange` / `pagehide`; merge bookmarks on write; save
      the stored tilt and the flat flag.

### B44.10 Physics decisions (F7, F8, F9, F10, F31)

- [ ] Pierre decides F7 and F8; then the fixes, F9, F10, F31.

### B44.11 Minor and docs (F25–F30, F32, F33)

- [ ] The remaining small fixes and doc corrections.
