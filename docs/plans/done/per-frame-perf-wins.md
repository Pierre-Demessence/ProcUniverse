# Per-frame performance wins

Cheap hot-path fixes found in the performance investigation (the starfield
rebuild fix shipped separately, see
[done/starfield-rebuild-perf.md](done/starfield-rebuild-perf.md)).

## Requirements

- THE SYSTEM SHALL key the galaxy-cell cache without building a string per
  lookup; galaxy lookups SHALL return the same results as before.
- WHEN a glow tier renders, THE SYSTEM SHALL iterate its glow field once per
  frame and scan the dominant galaxy once per galaxy-tier cell.
- WHEN the star tier renders, THE SYSTEM SHALL look up each visible sector once
  per frame, cull without allocating, and reuse parsed star colours.
- THE SYSTEM SHALL push the bookmark list to its panel only when its contents
  change.

## Tasks

- [x] `galaxyInCell`: numeric key (bounded cell range, uncached beyond it);
      clear the cache when the seed changes.
- [x] `forEachGalaxyGlow`: use `galaxySampleAt`.
- [x] `renderGlowTier`: one pass into a reusable scratch buffer.
- [x] `renderStars`: one `cache.get` per sector, inline cull, cached colours.
- [x] `createBookmarkList.update`: push only on change.
- [x] Tests for the galaxy cache key (far cells, seed switch).
- [x] Remove the shipped items from `docs/roadmap.md`.
- [x] Build, test, lint; benchmark before/after.
- [x] Peer review.
