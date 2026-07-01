# Human-Readable Names

**Goal:** Replace the base-36 catalogue numbers (`G-4F2A9`, `NGC-4F2A9`) with
pronounceable, fun names (`Talos`, `Korvannis`), while keeping the scientific
designations available as a user-toggleable option.

## Design decisions (answered by Pierre)

- Galaxy names: **just the generated word** (no NGC prefix).
- Star names: **drop the spectral class prefix** (class is inspector data).
- Earth-like planets (ESI ≥ 0.85): **replace the orbital letter entirely** —
  the planet is just `Eden`, not `Talos d · Eden`.
- Capitalization: **Title Case** for all names.
- **Toggle:** both naming styles coexist; a setting lets the user switch between
  `Scientific` and `Human` at any time.

---

## Architecture: dual-name scheme

Every body stores **two** names — both deterministic, both generated from the
same hash, neither needs persistence:

| Field | Purpose | Examples |
|-------|---------|----------|
| `scientific` | Stable unique key, always the current catalogue designation | `G-4F2A9`, `NGC-4F2A9`, `G-4F2A9 b` |
| `human` | Human-readable display name for the new style | `Talos`, `Korvannis`, `Talos b` |

The `NameDef` component changes from `{name: string}` to `{scientific: string; human: string}`.
All consumers use a `displayName(name, style)` helper that picks the right field.

The `scientific` field also serves as the **stable identity key** for
nav-tree node resolution, `findEntityByName`, and pick lookups — it never
changes regardless of the toggle, so selection/persistence/tree are unaffected.

---

## Phase 1 — Syllable generator

New file `src/generation/syllables.ts`.

### Inventory

Three arrays; together they produce ~24K distinct syllables:

- **Onsets** (~40): `b, bl, br, c, ch, cl, cr, d, dr, f, fl, fr, g, gl, gr, h, j, k, kl, kr, l, m, n, p, pl, pr, qu, r, s, sh, sl, st, str, t, th, tr, v, vr, w, z`
- **Vowels** (~20): `a, e, i, o, u, ae, ai, au, ea, ee, ei, eu, ia, ie, io, oa, oi, oo, ou, ua`
- **Codas** (~30): `'' (empty), b, d, g, k, l, m, n, p, r, s, t, v, x, z, ld, ls, nd, ng, nk, ns, nt, rd, rk, rs, rt, sk, st`

### Algorithm

A simple LCG produces an unlimited deterministic sequence from a single `uint32`
hash — no RNG stream consumed, physics draws untouched:

```
state = hash
next() → state = state * 1103515245 + 12345; return (state >> 16) & 0x7FFF

generateWord(hash, minSyllables, maxSyllables):
  next = lcg(hash)
  count = minSyllables + next() % (maxSyllables - minSyllables + 1)
  for each syllable:
    onset = ONSETS[next() % ONSETS.length]
    vowel = VOWELS[next() % VOWELS.length]
    coda  = CODAS[next() % CODAS.length]  if next() % 3 ≠ 0 (2/3 chance)
  Title-case the result
```

### Collision resistance

~24K syllable variants → ~1.4×10¹³ for 3-syllable names. Birthday-paradox
threshold is ~3.7 million names before 50% collision odds. The player sees at
most ~100 galaxies and ~1000 stars on screen — zero visible duplicates.

### Function signatures

```typescript
/** Generate a title-cased word from `hash`, 2–4 syllables by default. */
export function generateWord(hash: number, minSyllables?: number, maxSyllables?: number): string;
```

---

## Phase 2 — Naming functions: produce both names

Modify `src/generation/naming.ts`. Every name-returning function now returns a
`{scientific, human}` object:

```typescript
export interface GeneratedName {
  scientific: string;
  human: string;
}

// Galaxies
export function nameGalaxy(galaxyHash: number): GeneratedName;
//   scientific: "NGC-4F2A9"  (unchanged)
//   human:      "Korvannis"  (generateWord(hash, 2, 3))

// Stars
export function nameStar(spectralClass: SpectralClass, systemHash: number): GeneratedName;
//   scientific: "G-4F2A9"    (unchanged)
//   human:      "Talos"      (generateWord(hash, 2, 3))

// Planets
export function namePlanet(
  star: GeneratedName,
  index: number,
  planetHash: number,
  esi?: number,
): GeneratedName;
//   scientific: "G-4F2A9 b"  (unchanged)
//   human:      "Talos b"     (star.human + suffix)
//   human (ESI≥0.85): "Eden" (earthlikeName(planetHash), drops suffix)

// Moons
export function nameMoon(planet: GeneratedName, index: number): GeneratedName;
//   scientific: "G-4F2A9 b IV"  (unchanged)
//   human:      "Talos b IV"    (planet.human + romanNumeral)
```

### Earth-like planet names

Curated list of ~20 proper names, deterministic per planet:

```
Gaia, Terra, Eden, Avalon, Arcadia, Elysium, Haven, Cradle,
Pacha, Midgard, Aaru, Dilmun, Asphodel, Ama, Pangaea, Nova,
Aurora, Verdant, Oceana, Empyrea
```

Selected via `list[planetHash % list.length]`. ESI threshold: `≥ 0.85`.

---

## Phase 3 — `NameDef` component & `displayName` helper

### Component change

```typescript
// OLD
export interface BodyName { name: string; }

// NEW
export interface BodyName {
  scientific: string;
  human: string;
}
```

### Display helper (also in `naming.ts`)

```typescript
export type NamingStyle = 'human' | 'scientific';

export function displayName(name: BodyName | undefined, style: NamingStyle): string {
  if (!name) return 'Unknown';
  return style === 'human' ? name.human : name.scientific;
}
```

### Stable identity

`findEntityByName` in `pick.ts` searches `scientific` (the immutable key).
Nav-tree node keys use `scientific`. The toggle never changes identity.

---

## Phase 4 — Settings & options UI

### New setting (`src/settings.ts`)

```typescript
export type NamingStyle = 'human' | 'scientific';
export const namingStyle = signal<NamingStyle>('human'); // default: the new shiny
export function setNamingStyle(style: NamingStyle): void;
// resetSettings resets to 'human'
// Persisted under key 'namingStyle' in preferences
```

### Options menu (`src/ui/options.tsx`)

New `Segmented` row: **Names: Scientific | Human**. Placed below "Body scale".

---

## Phase 5 — Update all consumers

Every site that reads a name for **display** must use `displayName(name, namingStyle.value)`:

| File | What reads names | Change |
|------|-----------------|--------|
| `render/draw-labels.ts` | Body labels on canvas | `name.name` → `displayName(name, style)` |
| `ui/inspector.tsx` | Inspector title + rows | `name.name` → `displayName(name, style)` |
| `ui/nav-tree.tsx` | Tree node labels | Label = `displayName`, key = `name.scientific` |
| `render/draw-coords.ts` | Galaxy name in HUD | `galaxy.name` → use `displayName` |
| `render/select-reticle.ts` | Reticle label (if any) | Same pattern |
| `pick.ts` | `findEntityByName` | Search `scientific` field |
| `generation/universe.ts` | SMBH name (`name SMBH`) | Build `GeneratedName` for BH |

### Signal subscription pattern

Components that render names (inspector, nav-tree) subscribe to
`namingStyle.value` via Preact signals — the panel auto-re-renders on toggle.
Canvas-drawn labels (draw-labels, draw-coords) read `namingStyle.value` each
frame since they already redraw every frame.

---

## Phase 6 — Tests

- `syllables.test.ts`: determinism (same hash→same word), uniqueness (N words
  from sequential hashes are mostly distinct), length bounds, title case,
  character set sanity.
- `naming.test.ts`: update all existing tests for new return shapes; add tests
  for `displayName`, `earthlikeName`, Earth-like vs standard planet naming,
  galaxy/star/moon human names are non-empty and ≠ scientific.
- `settings.test.ts`: add `namingStyle` signal + persistence cases.
- Update `pick.test.ts`, `nav-tree.test.ts`, `inspector.test.ts` for new
  `BodyName` shape.
- `moons.test.ts`, `galaxies.test.ts`, `universe.test.ts`: fixture updates for
  new return shapes.

---

## Determinism & backward compatibility

- **Same hash → same pair of names.** Both `scientific` and `human` are pure
  functions of the hash. No RNG stream consumed, no new draws.
- **Universe shifts** (different names for a given seed), but physics/orbits/
  planet counts are untouched — only the `NameDef` component values change.
  This matches every prior data change in the project.
- **The `scientific` name is byte-identical to the old `name`** for stars,
  planets, moons, and galaxies — so any code/tests that depended on the old
  format still pass when reading `scientific`.

---

## Implementation order

- [x] 1. `src/generation/syllables.ts` — LCG + `generateWord` + inventories
- [x] 2. `src/generation/syllables.test.ts` — determinism, uniqueness, bounds
- [x] 3. `src/generation/naming.ts` — `GeneratedName` interface, update all
       functions, add `displayName` helper, add Earth-like name list
- [x] 4. `src/settings.ts` — `NamingStyle` type + signal + persistence
- [x] 5. `src/ui/options.tsx` — "Names" segmented control
- [x] 6. Update all name consumers (labels, inspector, nav-tree, coords, pick)
- [x] 7. Update `universe.ts` call sites (pass new shapes, compute ESI for planets)
- [x] 8. Update all tests
- [x] 9. `npm run lint:fix && npm run build && npm test`
- [x] 10. Peer review (fast model) — 1 CRITICAL fixed (draw-galaxy-field labels), 1 SHOULD-FIX fixed (duplicate NamingStyle type deduplicated), 1 SHOULD-FIX deferred (Earth-like names lose star context — by design per Pierre's "Replace the letter" choice)
- [ ] 11. Move plan to `docs/plans/done/`
