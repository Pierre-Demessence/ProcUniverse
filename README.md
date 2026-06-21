# ProcUniverse

A procedurally generated 2D universe explorer — pan and zoom across a flat,
effectively-infinite field of star systems with planets orbiting in real time.
Built on the sibling `@pierre/ecs` engine (checked out at
`../Entity-Cornponent-System-Engine`).

## Status

Phase 0 (scaffold): a pannable, zoomable plane with an FPS HUD and a single
placeholder star. Roadmap:
[docs/plans/procedural-universe.md](docs/plans/procedural-universe.md).

## Requirements

- Node.js 20 or newer.
- The `@pierre/ecs` engine checked out as a sibling folder at
  `../Entity-Cornponent-System-Engine` (consumed via a `file:` dependency).

## Install and run

```sh
npm install
npm run dev      # http://localhost:5180
```

Validate with `npm run typecheck`, `npm test`, or `npm run build`.

## Controls

- Drag to pan.
- Scroll to zoom toward the cursor.

## Documentation

See [docs/INDEX.md](docs/INDEX.md).
