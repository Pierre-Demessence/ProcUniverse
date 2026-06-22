# Plan — Migrate HUD overlays to Preact

The canvas/ECS render loop stays imperative; only the DOM HUD overlays
([time-controls](../../src/ui/time-controls.ts) and
[inspector](../../src/ui/inspector.ts)) move to Preact so their markup is
declarative instead of dozens of `createElement` + `cssText` calls. The win is
maintainability (and it scales to Phase G, which extends the inspector to
galaxies / black holes).

## Requirements (EARS)

- THE SYSTEM SHALL render the time-controls and inspector overlays as Preact
  components, preserving their current appearance and behaviour.
- THE SYSTEM SHALL keep the public module API unchanged — `createTimeControls`
  and `createInspector` still return imperative handles (`update(...)`,
  `timeScale`, `dispose()`) — so `main.ts` and the render loop are untouched.
- WHEN the render loop pushes a per-frame value (sim date), THE SYSTEM SHALL
  update only the affected text node, not re-render the whole component.
- THE SYSTEM SHALL keep every existing exported pure formatter
  (`formatSimDate`, `formatRate`, `sliderToScale`, `sigFigs`, `formatLifetime`,
  …) so the current unit tests pass unchanged.
- THE SYSTEM SHALL keep the static pipeline green (`tsc`, `vite build`,
  `vitest`, `eslint`).

## Design / decisions

- **D1 — Preact + `@preact/signals`.** Hooks alone would force a full component
  re-render every frame for the live sim-date. A signal bound directly in JSX
  (`<span>{simDate}</span>`) updates just the text node — so signals are both
  cleaner *and* more efficient for the per-frame values. Two tiny deps
  (~4 KB + ~2 KB).
- **D2 — `@preact/preset-vite`** for the JSX transform + Preact HMR (prefresh).
  `tsconfig`: `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`. Vitest reuses
  the vite plugin, so `.tsx` transforms identically in tests.
- **D3 — Preserve the handle API (minimal blast radius).**
  `createTimeControls(container)` still returns `{ element?, timeScale, update,
  dispose }` and `createInspector(container)` still returns `{ update, dispose }`.
  Internally each mounts a Preact tree into its own node and the handle methods
  write to signals:
  - `timeScale` getter → `timeScaleSignal.value`; the slider sets it.
  - `update(simSeconds)` → `simSecondsSignal.value = simSeconds`.
  - inspector `update(world, selection)` → `selectionSignal.value = selection`
    (same object ref between picks ⇒ signal dedupes ⇒ re-renders only on a real
    selection change; seed-stable data is read from `world` at render time).
  Result: **`main.ts` does not change.**
- **D4 — Rename `*.ts` → `*.tsx`** for the two overlays. Test files import by
  extensionless path, so they keep resolving. Pure formatters stay in the same
  modules (or move to a `*.format.ts` sibling if cleaner for node-env tests).
- **D5 — eslint:** keep it minimal — antfu already lints `.tsx` for TS/stylistic
  rules. Enabling antfu's `react` preset (rules-of-hooks, etc.) is an *optional*
  follow-up, not part of this migration (Pierre stripped it deliberately).
- **D6 — vitest:** no new component/DOM tests (matches today's approach where the
  DOM panels are untested); formatter tests stay node-env and unchanged.

## Tasks

- [x] Add deps: `preact`, `@preact/signals`, `@preact/preset-vite` (dev).
- [x] `tsconfig.json`: add `jsx` + `jsxImportSource`.
- [x] `vite.config.ts`: register `@preact/preset-vite`.
- [x] Convert `src/ui/time-controls.ts` → `.tsx` (signals; same handle API +
      same exported formatters).
- [x] Convert `src/ui/inspector.ts` → `.tsx` (signals; same handle API + same
      exported formatters).
- [x] Confirm `main.ts` is unchanged and the formatter tests pass as-is.
- [x] Docs: `tech-stack.md` (add Preact), `codebase.md` (UI is Preact).
- [x] Static pipeline green (`npm run build`, `npm test`, `npm run lint`).
- [x] Lightweight peer review.
- [ ] Hand off in-browser E2E (time slider + inspector) to Pierre.
```
