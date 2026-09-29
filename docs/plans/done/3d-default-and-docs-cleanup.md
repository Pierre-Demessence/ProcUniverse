# 3D by Default, Canvas 2D Frozen, Docs Cleanup

Make the Three.js renderer the default, keep Canvas 2D only as a frozen
fallback, and bring the project docs back in line with the code, with a single
living roadmap.

## Decisions

- **Three.js is the primary renderer and the default.** All new visual work
  targets it. A top-down view is the 3D view's existing Flatten toggle, so a
  separate 2D renderer is not needed for it.
- **Canvas 2D is frozen:** it receives no new features and exists only as the
  fallback when the Three backend cannot load or initialise. Removing it is a
  roadmap item, not part of this change.
- A stored explicit `renderBackend` preference is honoured; only the default
  changes.

## Requirements

- WHEN no renderer preference is stored, THE SYSTEM SHALL render with Three.js.
- IF the Three chunk fails to load or `WebGPURenderer.init()` rejects, THEN THE
  SYSTEM SHALL render every tier with Canvas 2D for the rest of the session and
  SHALL NOT retry the load every frame.
- WHILE Three is loading (not yet failed), THE SYSTEM SHALL keep the current
  no-flash behaviour.

## Tasks

- [x] `settings.ts`: default `renderBackend` → `'three'`.
- [x] `ThreeRenderer`: expose a `failed` flag set when `init()` rejects.
- [x] `main.ts`: track a Three load/init failure; treat `threeMode` as off once
  failed (full Canvas 2D fallback, no per-frame retry).
- [x] Unit test for the default renderer backend.
- [x] `docs/roadmap.md`: the single living backlog. Fold in `TODO.md` open items
  and every open / deferred item from `docs/plans/*` and the done-plan status
  lines; delete `TODO.md`.
- [x] Archive finished plans: `planet-rings.md`, `moons.md` → `plans/done/`
  (deferred items carried to the roadmap first).
- [x] Update `rendering-backend.md` and `system-visuals.md` status lines to
  match what has shipped; leave only in-flight work in `plans/`.
- [x] `README.md`: current description (3D systems), controls, CI badge,
  commands, link to the docs index.
- [x] `docs/INDEX.md`: list roadmap, research docs (incl. gas-giant shading),
  and drop the empty Plans heading.
- [x] `docs/agent/README.md`: drop frontmatter / `last-updated`, align with
  AGENTS.md (no agent browser testing), current commands, renderer invariant
  (Canvas 2D frozen), roadmap link.
- [x] `docs/codebase.md`: `config/` split, `render/three/`, renderer rule.
- [x] `docs/tech-stack.md`: renderer default and Canvas 2D role, present tense.
- [x] `docs/features.md`: renderer row, missing shipped features (moons, star
  shading, starfield, rings, oblateness), plain status values, roadmap link.
- [x] Build + tests + lint; peer review.
