# Bookmarks

Bookmark celestial bodies for quick return. A ☆ button in the inspector pins the
current selection to a persistent list; each bookmark zooms to and/or inspects
its body. Bookmarks are seed-bound (they reference bodies in a specific universe)
and persist alongside the save.

> Status: implementation complete; awaiting Pierre's browser test + commit.

## Requirements (EARS)

- WHEN the user clicks a "Bookmark" action in the inspector for a selected body,
  galaxy, or universe, THE SYSTEM SHALL add it to a persistent bookmark list
  with the body's identity, absolute position, and a framing extent.
- IF the current selection is already bookmarked, THEN the button SHALL show an
  "Un-bookmark" action that removes it.
- THE SYSTEM SHALL display a bookmark list panel showing every bookmark as a row
  with a kind glyph, the display name, and two action buttons: zoom-to and
  inspect.
- WHEN the user clicks "Zoom to" on a bookmark, THE SYSTEM SHALL move the camera
  to frame the bookmarked body at its stored extent.
- WHEN the user clicks "Inspect" on a bookmark, THE SYSTEM SHALL set it as the
  active inspector selection and, if the body is not currently streamed, also
  zoom to it so it becomes visible.
- IF a bookmarked body cannot currently be resolved (e.g. the system tier is not
  active, so its entities are not streamed), THEN the inspect action SHALL still
  zoom to the body so the tier change streams it in, and the selection SHALL
  resolve on the next frame.
- THE SYSTEM SHALL persist bookmarks as part of the universe save (seed-bound),
  writing them on every add/remove and loading them on startup.
- THE SYSTEM SHALL show a cue when the bookmark list is empty (e.g. "No
  bookmarks yet — select a body and click ☆").

## Design

### Bookmark identity

A bookmark is a self-contained record — it carries everything needed to zoom to
its body and to identify it for the inspector, without depending on the body
being currently streamed:

```typescript
interface Bookmark {
  /** Scientific catalogue designation (empty for universe). Stable key. */
  name: string;
  /** Human-readable label shown in the list. */
  label: string;
  /** Body kind for glyph + resolution strategy. */
  kind: 'galaxy' | 'moon' | 'planet' | 'star' | 'universe';
  /** Absolute world position (AU), for camera centring. */
  x: number;
  y: number;
  /** Extent (AU radius) to frame on zoom-to. */
  extentAu: number;
}
```

- `name` is the scientific catalogue designation (e.g. `G-4F2A9`, `NGC-XXXXX`,
  `G-4F2A9 b`, `G-4F2A9 b I`, or `""` for the universe). It is the stable key
  within a seed.
- Bodies are resolved by `findEntityByName(world, name)` at the system tier;
  galaxies by `galaxyAt(seed, x, y)`; the universe directly.
- `x, y` are **absolute** world AU (not render-origin-relative), captured at
  bookmark time. On zoom-to they are converted to the current render-origin
  frame.
- `extentAu` is the same framing radius `frameSelection` would use — the larger
  of the visual disc times a margin factor and the satellite system's apoapsis.
  Computed once at bookmark-creation time.

### Persistence

Bookmarks are **seed-bound** — they name bodies that only exist in one universe.
They live in the existing `procuniverse:save` bucket, alongside `view`,
`simSeconds`, and `speedIndex`:

```typescript
// Added to Save:
bookmarks: Bookmark[];
```

- `parseSave` fills a default `[]` when the field is absent (backward-compatible
  with existing saves).
- `writeSave` persists the full array. The save is written on unload (existing
  behaviour) AND on every bookmark add/remove (explicit `writeSave` call after
  mutation).
- Bookmarks are NOT in the preferences store — they do not survive a seed reset.
  If the user mints a new universe, the bookmark list resets with it (old bodies
  no longer exist).

### Bookmark list panel (`src/ui/bookmark-list.tsx`)

A Preact + signals panel, positioned **top-left below the nav-tree** (the only
free HUD corner):

```
┌──────────────┐
│ LOCATION     │  ← nav-tree (existing)
│ ◎ Universe   │
│   ◎ NGC-12AB │
│     ☉ G-4F2A9│
│       ◦ b    │
├──────────────┤
│ BOOKMARKS    │  ← NEW panel
│ ☆ ☉ G-4F2A9  │  Zoom  Inspect
│ ☆ ◎ Home     │  Zoom  Inspect
│ (empty hint) │
└──────────────┘
```

- Each row: kind glyph, label (truncated with ellipsis), then two small text
  buttons (`[Zoom]` `[Inspect]`). Hover reveals a remove (✕) button at the
  right edge.
- Empty state: a dim italic line "No bookmarks yet — select a body and click ☆."
- The panel shares the same visual style as the nav-tree (dark glass, same font,
  same border-radius).
- The bookmark list signal is read each frame; the panel re-renders only when
  the list changes (reference equality on the array).
- Max-height with overflow-y scroll for long lists.
- The create function signature:

  ```typescript
  createBookmarkList(container, {
    bookmarks: Signal<Bookmark[]>,
    onInspect: (bm: Bookmark) => void,
    onRemove: (bm: Bookmark) => void,
    onZoom: (bm: Bookmark) => void,
  }) → { dispose }
  ```

### Bookmark button in the inspector

A third action button in the inspector footer (alongside "Zoom to" and "Lock"):

```
[  Zoom to  ] [  Lock  ] [  ☆ Bookmark  ]
```

- When the current selection is NOT bookmarked: shows `☆ Bookmark`. Click fires
  `onBookmark`.
- When the current selection IS bookmarked: shows `★ Bookmarked` (filled star,
  dimmed). Click fires `onUnbookmark`.
- The inspector receives a new `isBookmarked` boolean prop (or a signal) so it
  can render the correct variant without storing bookmark state itself.
- `InspectorActions` gains `onBookmark` and `onUnbookmark` callbacks.

Alternatively — simpler, consistent with how `onZoomTo`/`onToggleLock` work: a
single `onToggleBookmark` callback; the button label reflects current state
determined by a boolean passed to the inspector's update.

**Preferred approach** (less plumbing): the inspector already receives
`InspectorActions` callbacks. Add `onToggleBookmark: () => void` and a
`bookmarked: boolean` field. The button renders `☆ Bookmark` or `★ Bookmarked`
based on `bookmarked`. `main.ts` toggles — add if not bookmarked, remove if
bookmarked.

### Wiring in `main.ts`

**Bookmark creation** (when `onToggleBookmark` fires):

1. Read the current `Selection`.
2. Compute `x, y` (absolute world position) and `extentAu` using the same logic
   as `frameSelection`:
   - Universe: `{ x: 0, y: 0, extentAu: SECTOR_SIZE * 10 }` (wide framing).
   - Galaxy: `{ x: galaxy.centerX, y: galaxy.centerY, extentAu: galaxy.radius * GALAXY_SPRITE_SCALE }`.
   - Body (star/planet/moon/black-hole): read `PositionDef` for position, look
     up physical data for disc radius, compute satellite apoapsis via
     `starSatelliteApoapsis` / `planetSatelliteApoapsis` (same helpers
     `frameSelection` uses). Position is in the render-origin frame — convert to
     absolute via `cameraAbsolute(renderOriginX, pos.x)`.
3. Build the `Bookmark` object with `name` from `NameDef` (or galaxy name, or
   `""` for universe) and `label` from `displayName()`.
4. Check for duplicate (same `kind` + `name`) — if exists, remove instead
   (toggle behaviour).
5. Push to `bookmarks` array, call `writeSave(save)`.
6. Update the bookmark signal so the list panel re-renders.

**Bookmark zoom-to** (when the list panel's Zoom button is clicked):

1. Compute `localX = bookmark.x - renderOriginX`, `localY = bookmark.y - renderOriginY`.
2. Set `camera.x = localX`, `camera.y = localY`.
3. Set `camera.zoom = frameZoom(bookmark.extentAu, vpW, vpH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM)`.
4. Release any lock (`lockedId = null`).
5. The next frame the tier system detects the new position and streams the
   appropriate sector.

**Bookmark inspect** (when the list panel's Inspect button is clicked):

1. First, zoom to the bookmark (same as zoom-to above) — this guarantees the
   body will be streamed.
2. Set `selection`:
   - `universe` → `{ kind: 'universe', seed }`.
   - `galaxy` → `galaxyAt(seed, bookmark.x, bookmark.y)` (recompute from stored
     position; the galaxy cell is deterministic so this always works).
   - `star`/`planet`/`moon`/`black-hole` → `findEntityByName(world, bookmark.name)`.
     If `null` (not yet streamed), set a **pending bookmark selection** flag so
     the next frame retries `findEntityByName` until the entity appears.
3. Once resolved, clear the pending flag and set `selection` normally.

**Pending bookmark resolution**: a module-level variable `pendingBookmark:
Bookmark | null`. At the top of the render loop (before lock processing), if
`pendingBookmark` is set, try `findEntityByName(world, pendingBookmark.name)`.
If found, set `selection`, clear `pendingBookmark`, and optionally lock (for
planets/moons — consistent with the existing `onZoomTo` behaviour).

**`isBookmarked` check**: a helper `isBookmarked(bookmarks, selection)` that
compares `kind` + `name` (scientific). Called each frame; the result passed to
`inspector.update()`.

**Save changes**: `Save.bookmarks: Bookmark[]` added. `parseSave` defaults to
`[]`. `writeSave` already persists the whole save. The teardown function already
calls `writeSave`, so unload persistence is automatic. Explicit writes on
add/remove for crash-safety.

### No new dependencies

Bookmarks use only the existing stack: Preact + signals for the list panel, the
existing `writeSave` for persistence, the existing `frameZoom`/`frameSelection`
helpers for framing, and the existing `findEntityByName`/`galaxyAt` for
resolution. No new npm packages.

## Tasks

- [x] `src/bookmarks.ts` — `Bookmark` type, `isBookmarked(bookmarks, selection)`,
      `bookmarkKey(bm)` helper.
- [x] `src/persistence/save.ts` — add `bookmarks: Bookmark[]` to `Save`, default
      `[]` in `parseSave`.
- [x] `src/ui/bookmark-list.tsx` — bookmark list panel (Preact + signals):
      createBookmarkList, empty-state hint, rows with glyph + label + Zoom /
      Inspect / Remove actions.
- [x] `src/ui/inspector.tsx` — add ☆/★ bookmark toggle button in the action
      footer; accept `bookmarked` boolean + `onToggleBookmark` callback.
- [x] `src/main.ts` — wire:
      - Bookmark creation/removal (compute position + extentAu, add to save).
      - Bookmark zoom-to (set camera position + zoom).
      - Bookmark inspect (zoom + findEntityByName, pending retry).
      - Pass `bookmarked` to inspector each frame.
      - Mount bookmark list panel.
      - Persist on add/remove.
- [x] Unit tests: `save.test.ts` (parseSave fills default [], bookmark parsing
      + validation).
- [x] Static pipeline green (`npm run build`, `npm test`, `npm run lint`).
- [x] Lightweight peer review (fast model) — 3 issues found + fixed.
- [x] Update `docs/features.md` (+ bookmarks row) and `docs/codebase.md` (new
      `src/ui/bookmark-list.tsx` + `src/bookmarks.ts`).
- [x] Tick checklist items in this plan.
- [x] Hand off in-browser E2E (bookmark a star, planet, galaxy; zoom to each;
      persist across reload; remove) to Pierre.

## Deferred / out of scope

- Bookmark reordering (drag-and-drop or manual sort). v1 is insertion-order.
- Bookmark folders / categories.
- Bookmark notes or custom labels (uses the body's display name).
- Cross-seed bookmark export/import (bookmarks are seed-bound by design).
- Bookmark count badge on the inspector button.
