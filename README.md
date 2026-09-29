# ProcUniverse

[![CI](https://github.com/Pierre-Demessence/ProcUniverse/actions/workflows/ci.yml/badge.svg)](https://github.com/Pierre-Demessence/ProcUniverse/actions/workflows/ci.yml)

A procedurally generated universe explorer for the browser. Zoom from the
cosmic web down through galaxies and star fields into individual planetary
systems, rendered in 3D with Three.js — lit, rotating planets and moons on real
Keplerian orbits. Everything regenerates from a single seed, backed by real
astrophysics. Built on the sibling `@pierre/ecs` engine.

Play it on [itch.io](https://corniflex.itch.io/procuniverse).

## Requirements

- Node.js 20 or newer.
- The `@pierre/ecs` engine checked out as a sibling folder at
  `../Entity-Cornponent-System-Engine` (consumed via a `file:` dependency).

## Install and run

```sh
npm install
npm run dev      # http://localhost:5180
```

Validate with `npm run build` (typecheck + bundle), `npm test`, and
`npm run lint`.

## Controls

- Left-drag to pan; scroll to zoom toward the cursor.
- Right-drag to orbit and tilt the 3D system view; **Flatten** snaps it top-down.
- Click a body to inspect it; Escape dismisses.

## Documentation

See [docs/INDEX.md](docs/INDEX.md).
