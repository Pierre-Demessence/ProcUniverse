# Gas-giant shading & aesthetic — research

Research for the gas/ice-giant slice of the planet-surface overhaul
([planet-surfaces.md](../plans/planet-surfaces.md), Phase 5). The first two
shader attempts moved but looked "ugly / not gaseous / not like Jupiter." This
gathers (a) what real giants and the game/film aesthetic actually look like, and
(b) the proven procedural techniques, then distills a concrete recipe and
explains precisely why the earlier attempts missed.

> Status: research only, no code. Feeds the Phase-5 (static) and Phase-6
> (motion) shader work.

## 1. What a gas giant actually looks like (the target)

From the *Atmosphere of Jupiter* (see §7 sources) and Neptune/Uranus imagery:

### 1.1 Banded structure — the dominant, defining feature

- The visible disc is divided into **~a dozen horizontal bands parallel to the
  equator**. Two kinds, alternating:
  - **Zones** — light (cream / white / pale ochre). Colder, *upwelling* air,
    high ammonia-ice clouds.
  - **Belts** — dark (tan / brown / rust / ochre). Warmer, *downwelling*, thinner
    clouds revealing lower, darker material.
- **The bands and their colours ARE the look.** A viewer reads "gas giant" from
  the clean, coloured, horizontal banding first and foremost.
- **Band positions and widths are remarkably stable** over decades — they do not
  wander. They vary in *colour/intensity* over years, not in latitude.
- Bands are widest/most distinct at low latitudes; **poles (> ~48°) are muted,
  bluish-grey and nearly featureless**. There is visible **limb darkening**
  toward the edge of the disc.

### 1.2 Zonal jets — the motion

- Bands are bounded by **zonal jets** (winds) that **alternate direction**
  band-to-band: eastward (prograde) at some boundaries, westward (retrograde) at
  others. The **equatorial zone has a strong prograde jet**; speeds exceed
  100 m/s (equatorial features move ~390 km/h relative to other latitudes).
- Crucially for us: **the flow is almost purely longitudinal (east-west). Bands
  stream sideways; they do not move in latitude.** The visible motion is belts
  and their features sliding in longitude at different rates → **shear at the
  boundaries**.

### 1.3 Boundary turbulence — festoons, plumes, wisps

- At the shear between a belt and a zone, the flow is turbulent: **festoons**
  (dark bluish "hot spots"), **plumes** trailing off the equatorial belt,
  wisps and swirls. This is *localised at band boundaries*, not a uniform grain
  across the whole disc.

### 1.4 Discrete storms — a few big ovals, not speckle

- **Great Red Spot**: one huge oval anticyclone at ~22°S, brick-red to pale
  salmon, *wider east-west than north-south*, persists for centuries.
- **White ovals** (anticyclones, bright) and **brown "barges"** (cyclones).
  "Red Jr." (Oval BA) is a second red oval. Anticyclones are usually white; only
  a couple are red.
- Storms are **confined to a band's latitude**; they drift slowly in longitude
  but stay at their latitude. So: a handful of *discrete, oval, latitude-locked*
  features — never scattered noise dots.

### 1.5 Colour palette (Jupiter)

- Zones: cream / off-white / pale ochre.
- Belts: tan → light brown → rust/ochre → dark brown.
- Spots: brick-red / salmon (GRS), bright white (ovals), muted brown (barges).
- Poles: desaturated bluish-grey.
- Exact chemistry is uncertain (sulfur/phosphorus/carbon compounds), so we are
  free to pick a plausible palette — the *arrangement* (light zones alternating
  with darker belts, smoothly graded) is what sells it.

### 1.6 Ice giants are different — much smoother

- **Neptune**: deep blue (methane absorbs red), a *few* faint bands, occasional
  dark spots and bright white methane-cloud streaks. Far less structure than
  Jupiter.
- **Uranus**: almost **featureless pale cyan**. Banding barely visible.
- So ice giants want: a dominant latitude colour gradient (deep blue ↔ pale
  cyan), very low band contrast, little/no turbulence, maybe one faint spot.

### 1.7 Reference imagery (for eyeballing)

- Cassini true-colour Jupiter portrait (2000); Hubble **OPAL** annual maps
  (approx true colour); **JunoCam** processed images (dramatic swirls).
- Voyager/Hubble Neptune (deep blue + Great Dark Spot); Voyager Uranus (blank
  cyan). Search these to calibrate the palette and band spacing.

### 1.8 Not all gas giants are Jupiter — the variety, and what drives it

Jupiter's tan/cream/brown belts are **one temperature regime**, not the
universal look. The dominant driver is **temperature** (irradiation + internal
heat), because it decides *which chemicals condense into clouds* — and the
clouds are what we see. This is largely understood, so it can be **data-driven,
not random**. Three broad gas-giant regimes, plus modifiers:

- **Hot (roasting, ≳ 800–1000 K — "hot Jupiters", close-in / young):** too hot
  for ammonia/water clouds, so **little to no banding**. They read as **dark,
  nearly featureless deep red-brown / blue-black**, and the hottest ones
  **glow** dull red/orange (thermal emission on the day side). Silicate / iron
  "rock-vapour" clouds are possible. Essentially the opposite of Jupiter's busy
  face.
- **Warm / temperate (≈ 100–350 K — Jupiter/Saturn range):** the classic
  **cream zones + tan/brown/rust belts**. This is the recognizable banded look
  of §1.1–1.5. (Even here, **Saturn is far blander than Jupiter** — a thick
  high haze mutes the contrast; a "haziness" knob covers this.)
- **Cold (≲ 100 K — far from the star):** colourful clouds sink deep and a haze
  sits on top → **pale, desaturated, bluish, low-contrast** banding.

Secondary, also-understood modifiers:

- **Rotation rate → band count.** Faster spin ⇒ stronger Coriolis ⇒ **more,
  tighter zonal jets and bands** (Jupiter ~10 h → many bands); slow rotators get
  fewer, broader bands. We already store `rotationPeriod`, so **band count is a
  direct function of it**.
- **Age / internal heat:** young giants glow from formation heat (folds into the
  "hot/glowing" end).

**Design implication:** replace a single warm↔cold two-colour lerp with a
**temperature-selected regime** (hot / warm / cold palette + contrast +
storminess), and derive **band count from `rotationPeriod`**. No new data or RNG
draws — `equilibriumTemp`, `rotationPeriod`, `mass`, `insolation` already exist.

### 1.9 Ice giants belong here — as a distinct regime, not a separate effort

Ice giants (Neptune, Uranus) *look* different from gas giants but are drawn with
the **same technique** — they are a low-contrast, methane-blue **parameter
regime** of the same shader, not a new rendering approach or a separate research
effort. The physical difference (a methane-rich outer atmosphere that absorbs
red light) shows up purely as **palette + smoothness**:

- **Blue/cyan palette** (methane absorption), **very low band contrast**, **few
  or no visible belts**, **little turbulence**, **~no big storms** (Neptune gets
  one faint dark spot; Uranus is essentially featureless).
- Temperature still modulates within the regime: warmer/more-active →
  Neptune-like (deep blue, faint bands, a dark spot); colder → Uranus-like
  (near-flat pale cyan).

So: keep ice giants in this plan; give them their **own regime constants**
(genuinely smoother and bluer), not "gas giant, slightly bluer."

## 2. Proven procedural techniques

### 2.1 fBM (fractional Brownian motion) — the texture primitive

- fBM = sum of noise octaves, each **2× the frequency and ~×0.5 the amplitude**
  (gain `G = 2^-H`; `G = 0.5`, i.e. `H = 1`, "yellow noise" — the smooth,
  natural-looking default used for clouds/terrain in film and games).
- **Fewer octaves + G = 0.5 → smooth, low-frequency, natural.** Many octaves or
  high gain → high-frequency **grain** (this is what made ours look noisy).
- Detune octaves (×2.01 instead of ×2) and rotate the domain per octave to avoid
  axis-aligned artefacts. (Iñigo Quilez, *fBM*.)

### 2.2 Domain warping — the "gaseous swirl" look

- The signature fluid look comes from **feeding fBM back into its own input**
  (Iñigo Quilez, *Domain Warping*):
  - `q = fbm(p)`
  - `r = fbm(p + 4·q + offsetA)`
  - `value = fbm(p + 4·r + offsetB)`
- The intermediate warp fields (`q`, `r`) can **also drive colour** (mix palette
  by `r.x`, brighten by `q.y`, …) for rich, coherent variation.
- This produces smooth, swirling, marbled flow — exactly the "gaseous" quality —
  **without** high-frequency grain. It is the core technique to adopt.

### 2.3 Latitude as the primary colour axis (the missing piece)

- The banded planet look is achieved by mapping **latitude → a multi-stop colour
  ramp** (a 1-D palette across belts and zones). Domain-warp the latitude
  *slightly* so boundaries are wavy/festooned, but keep the warp small so the
  bands stay clean and stable. Bands = a smooth function of (warped) latitude
  through the palette; **not** a raw noise field, and **not** a two-colour sine.

### 2.4 Longitude-only advection for motion (and the stability fix)

- Animate by **rotating the sample longitude** over time, with an
  **alternating, latitude-dependent rate** (the jets). Bands stay at their
  latitude; their structure streams sideways; boundaries shear → festoons evolve.
- **The grain-over-time bug:** never add unbounded `time` to a noise sample
  *position* (`p + time·dir`). The coordinate grows without bound and the noise
  hash loses precision after a minute or two → the smooth field collapses into
  **grain** (exactly Pierre's "degenerates into grains" report). Fixes:
  1. Advect via **longitude rotation** — it is periodic (`cos`/`sin`), so
     coordinates never grow. This alone gives stable, endless motion.
  2. For churn/evolution, oscillate offsets with `sin/cos(time)` (bounded), or a
     curl-noise velocity field, or wrap time modulo a period.
- **Curl noise** (divergence-free) is the "proper" way to advect a fluid-like
  field and can be added later for extra realism; not required for v1.

### 2.5 Limb & poles

- Apply gentle **limb darkening** and desaturate/darken toward the poles
  (`|latitude|` high) to match the muted polar caps and rounded read. (We keep
  the material lit, so the terminator comes from the star light; limb darkening
  here is a subtle extra on the albedo.)

## 3. Why the earlier attempts looked wrong

| Symptom (Pierre) | Cause | Fix from research |
| ---------------- | ----- | ----------------- |
| "sphere with stripes", not gaseous | bands were a clean 2-colour `sin(latitude)`; no domain warping | §2.2 domain warp + §2.3 multi-stop latitude palette |
| "doesn't look like Jupiter" | only two colours (light/dark) | §1.5 multi-stop palette: cream zones, tan/brown/rust belts |
| "ugly / noisy" | brightness modulated by high-octave fBM → grain | §2.1 smooth fBM (G=0.5, few octaves); texture via warp, not grain |
| "degenerates into grains over time" | unbounded `time` added to noise sample position → precision breakdown | §2.4 longitude-rotation advection (bounded) + bounded churn |
| bands felt random when warped | strong warp fed into the band *phase* scrambled them | §2.3 warp latitude *slightly*; keep bands stable |

## 4. Recommended recipe (Phases 5–6)

All in TSL, lit `MeshStandardNodeMaterial` (albedo only), driven by
`PlanetPhysical` data. Pseudocode (per fragment):

Phase 5 (static) uses this recipe with `time = 0` (no advection, no churn);
the `time` terms are added in Phase 6 (band motion).

```text
lat   = positionLocal.y                       // −1..1, spin-axis aligned
lon   = atan2(positionLocal.z, positionLocal.x)

// 1. Zonal advection (bounded): rotate longitude by an alternating,
//    latitude-dependent rate. jetProfile alternates sign per band.
jet   = sin(lat * bandCount * π)              // alternating per band
lonA  = lon + time * windSpeed * jet          // periodic → never grows

// 2. Domain-warped coordinate for the *cloud/festoon detail* (smooth fBM,
//    G=0.5, 3–4 octaves). Build sample from (lonA, lat) on a cylinder so it
//    wraps seamlessly; add a per-planet seed offset (no RNG draw).
p     = cylinder(lonA, lat) * detailFreq + seed
q     = fbmVec(p)                             // 3 oct
warp  = fbmVec(p + 4·q + boundedChurn(time))  // 3 oct

// 3. Bands: latitude nudged a LITTLE by the warp, through a multi-stop palette.
bandLat = lat + warp.y * smallWaviness        // keep small → bands stay clean
belt    = paletteRamp(bandLat)                // 4–6 colour stops (zones+belts)

// 4. Subtle cloud shading from the warp field (low contrast, no grain).
albedo  = belt * (1 + warp.x * lowContrast)

// 5. A storm or two: one elongated oval at a belt latitude, drifting slowly in
//    longitude, tinted red/white; smoothstep mask, wider in lon than lat.
albedo  = mix(albedo, stormColor, stormOval(lonA, lat, seed))

// 6. Limb darkening + muted poles.
albedo *= limbDarken(viewAngle) * polarMute(lat)
```

Data → parameters (all already generated; **no new RNG draws**):

- `type` → gas vs ice regime family (ice = its own smooth, blue, low-contrast,
  storm-free regime — see §1.9).
- `equilibriumTemp` → **selects/interpolates the regime** (§1.8): gas giants
  across **hot (dark/featureless/glowing) → warm (Jupiter belts) → cold
  (pale/blue)**; ice giants across **Uranus (near-flat pale cyan) → Neptune
  (deep blue, faint bands, dark spot)**. Each regime carries its own multi-stop
  palette, band contrast, turbulence, storminess, and storm tint.
- `rotationPeriod` → **band count** (§1.8): faster spin ⇒ more, tighter bands
  (sub-linear map, clamped); ice giants get fewer.
- per-planet variety `seed` → hash of existing fields (e.g. mass + Teq); offsets
  the noise + storm placement so two same-type giants differ.

Regime = a multi-stop **latitude palette** (equator → pole) sampled by `|lat|`
for the broad colour progression, with a higher-frequency belt oscillation
(`sin(bandLat · bandCount · π)`) lightening/darkening it by `bandContrast` for
the alternating zones/belts. Poles are the muted final stop.

Palette guidance (raw sRGB, ColorManagement disabled) — each regime is a
5-stop latitude ramp (equator → pole):

- **Gas, warm (Jupiter-like):** cream `#e0d0a8`, tan `#c8a06e`, rust/brown
  `#9c6b43`, dark brown `#6e4a30`, muted grey-blue pole; belt oscillation
  lightens/darkens across these. Storm salmon/brick `#c66a4a` (GRS) or white
  ovals `#f0e8d8`.
- **Gas, cold:** desaturated blue-greys of the same ladder, low contrast.
- **Gas, hot:** dark ember red-browns with **near-zero contrast** (featureless),
  no storms; (optional later: an emissive glow term for the hottest — deferred).
- **Ice, Neptune (warmer):** deep blue `#3a6ec0` with faint lighter-blue bands,
  one dark spot `#1f3466`; very low contrast.
- **Ice, Uranus (cold):** near-flat pale cyan `#b8dce0`, barely-there banding,
  no storms.

## 5. Determinism, perf, and invariants (unchanged)

- Purely visual: **no new sampled fields, no new RNG draws** → universe stays
  byte-identical. Per-planet variety is a hash of existing data.
- **Wall-clock** time for animation (matches star-shading; no freeze-when-paused
  / strobe-under-time-warp).
- System tier, near giants only; far tiers untouched. A handful of spheres →
  a few fBM/warp evaluations per fragment is affordable (keep octaves low, which
  also looks better).
- Lit `MeshStandardNodeMaterial`, `colorNode` = albedo only → star point light
  still gives the day/night terminator.

## 6. Open choices for implementation

- **Palette source:** inline multi-stop ramp in `planet-surface.ts` (simple,
  tunable) vs a small generated 1-D gradient. Recommendation: inline ramp — no
  assets, easy to tune, matches the data-driven rule.
- **Storms:** 0–2 ovals for gas giants, scaled by a "storminess" param; none for
  ice giants (or one faint dark spot for Neptune-like).
- **Curl-noise advection:** defer to a later polish pass; longitude rotation is
  enough for v1.
- **Seam handling:** sampling on a cylinder from `atan2` has a longitude seam;
  sample 3-D noise on the sphere position instead (no seam) and advect by
  rotating the sample about the spin axis (as the current code already does) to
  avoid a visible join.

## 7. Sources

- *Atmosphere of Jupiter*, Wikipedia — belts/zones/jets, stability, festoons,
  storms (GRS, Oval BA, white ovals), polar muting, limb darkening, colours.
  <https://en.wikipedia.org/wiki/Atmosphere_of_Jupiter>
- Iñigo Quilez, *fBM* — octaves, gain `G=2^-H`, `G=0.5` smooth default, octave
  detuning. <https://iquilezles.org/articles/fbm/>
- Iñigo Quilez, *Domain Warping* — `fbm(p + fbm(p + fbm(p)))` for fluid swirls;
  warp fields also driving colour. <https://iquilezles.org/articles/warp/>
- Reference imagery: Cassini true-colour Jupiter; Hubble OPAL maps; JunoCam;
  Voyager/Hubble Neptune & Uranus.
