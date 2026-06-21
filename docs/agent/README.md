---
last-updated: 2026-06-21
applicable:
  - "**"
owner: Pierre
---

# Agent Operational Notes

Concise, machine-oriented facts for working in this repository.

## Purpose

A 2D procedural universe explorer built on `@pierre/ecs`. Free-floating camera
(no ship/avatar). The deepest zoom tier is a planetary system — there is no
planet-surface view.

## Commands

- `npm install` — install dependencies (links the sibling `@pierre/ecs`).
- `npm run dev` — Vite dev server on port 5180.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — typecheck then Vite production build.

## Key paths

- Engine (sibling): `../Entity-Cornponent-System-Engine`.
- Engine API catalog (read first): `../Entity-Cornponent-System-Engine/docs/agent/engine-api.md`.
- Roadmap: `docs/plans/procedural-universe.md`.

## Invariants

- The universe is a pure function of `(seed, coords)`. Never persist generated
  content — only the world seed and player deltas.
- Orbits are analytic (no N-body simulation). Systems stay static within their
  generating cell.
- Camera and pointer math run in canvas backing pixels; keep
  `camera.viewportW/H == canvas.width/height`.
- Entity rendering stays behind the engine `Renderer` interface (Canvas 2D for
  now); the debug grid and FPS HUD are Canvas2D-only.
- Validate real-time behavior in a browser before marking work done.
