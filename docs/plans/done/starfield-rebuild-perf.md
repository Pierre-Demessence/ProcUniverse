# Starfield rebuild performance

The background starfield dome regenerates its star cloud whenever the camera
moves ~50,000 AU (the cache key's position bucket). Each rebuild samples 180,000
candidate directions, each calling `galaxyDensityAt` and `galaxyActivityAt`
(two 3×3 dominant-galaxy scans): ~240 ms per rebuild (Node benchmark). The
renderer called `updateStarfield` on every tier, though the dome is only visible
at the system tier, so:

- Star tier: a hitch every ~1 sector of pan (fewer pixels the further out).
- Galaxy tier: a rebuild every frame while panning or zooming.
- Galaxy-field tier: rebuilds while the view centre is still over a galaxy.

A frame bug compounds it: `updateStarfield` passed the galaxy centre relative to
the render origin, while `generateStars` compares it with the absolute camera
position. The toward-core direction was wrong whenever the origin was not zero,
and the cache key and sky seed changed on every origin rebase.

## Requirements

- WHILE the tier is not `system`, THE SYSTEM SHALL NOT update or regenerate the
  starfield dome.
- THE SYSTEM SHALL key, seed and orient the starfield from the galaxy's absolute
  centre and the absolute camera position.
- WHEN the starfield regenerates, THE SYSTEM SHALL resolve each candidate's
  density and activity with a single dominant-galaxy scan.

## Tasks

- [x] Gate `updateStarfield` to the system tier in `render-systems.ts`.
- [x] Pass the absolute galaxy centre to the dome (drop the render-origin args).
- [x] Add `galaxySampleAt` (density + activity from one scan); use it in
      `generateStars`.
- [x] Unit test: `galaxySampleAt` matches `galaxyDensityAt` / `galaxyActivityAt`.
- [x] Record deferred performance work in `docs/roadmap.md`.
- [x] Update docs (`docs/agent/README.md` invariant).
- [x] Build, test, lint.
- [x] Peer review.
