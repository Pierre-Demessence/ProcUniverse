# Flat-view toggle (Stage 3 closeout)

Completes the last of the [rendering-backend.md](rendering-backend.md) §7 Stage 3
follow-ups: a **"view as flat" toggle**. Wraps up the true-3D pivot
([true-3d-systems.md](done/true-3d-systems.md)).

> Status: **done** — Pierre browser-confirmed "works perfectly". Landed together
> with the plane-anchored camera fix it depends on.

## Scope & decisions (from Pierre, 2026-07-03)

- **Flatten scope: camera only.** Snap the view straight down the focused
  system's orbital plane; orbits keep their true shape — because the camera is
  plane-anchored, looking straight down the disk renders the orbits as **circles
  around the centred star**.
- **Control: a contextual button that appears only inside a planetary system**
  in the Three (3D) renderer — not an Options-menu setting, since flatten is
  meaningless at every other tier (they are already top-down 2D) and in the
  Canvas 2D backend.
- **Un-flatten restores the prior tilt.** The stored tilt is never mutated while
  flat, so toggling off returns to the previous 3D angle.
- **Spin while flat.** A horizontal right-drag rotates the top-down map around
  its centre (azimuth) even while flat; a vertical drag is ignored (tilt stays
  locked). The rotation is shared, so it carries into the 3D view on toggle-off.
- **Not persisted across reloads** — a momentary in-session toggle; default is
  the normal tilted 3D view.

## Design

The flatten override lives entirely in the **camera controller**:

- A `flat` flag. While set, the `tilt` getter reports a near-straight-down angle
  (`FLAT_TILT`, a small config knob) instead of the stored tilt. A *true* zero
  tilt is avoided on purpose: at exactly straight-down the look-at direction
  meets the camera up-axis and the orientation collapses (an arbitrary roll —
  the reason `TILT_MIN` exists). `FLAT_TILT` (~1°) reads as top-down without that
  collapse. Because the camera is anchored to the system's disk normal, this
  looks straight down the disk, so orbits read as circles.
- **The stored `tilt` is never mutated while flat**, so clearing the flag
  restores the prior 3D angle. A vertical right-drag is ignored while flat; a
  horizontal right-drag still updates `azimuth`, spinning the top-down map.
- The Three renderer reads `controller.azimuth`/`controller.tilt` each frame,
  so top-down rendering + raycast picking follow the effective (flattened) tilt
  with no renderer change. The 3D pan branch uses the same effective tilt so a
  grabbed point stays under the cursor while flat.

A plain-DOM **flatten button** (mirrors the reset-view button) toggles its label
(`Flatten` ⇄ `3D view`) and calls back with the new state. `main.ts` shows it
only when `threeActive && tier === 'system'` and wires the callback to
`controller.setFlat`.

## Checklist

- [x] Camera controller: `flat` state, `setFlat`, effective-angle getters, orbit
      input guarded, 3D pan uses effective angles.
- [x] New `src/ui/flatten-button.ts` contextual toggle button.
- [x] `main.ts`: create the button, wire `onToggle` → `setFlat`, gate visibility
      on `threeActive && tier === 'system'`, dispose on teardown.
- [x] Static pipeline: `npm run build` + `npm test` + lint green.
- [x] Peer review (fast model), address findings.
- [x] Tick rendering-backend.md Stage 3 "view as flat" box; update docs.
- [x] Spin-while-flat: horizontal drag rotates the top-down map, vertical drag
      locked.

## Deferred / out of scope

- Re-flattening orbital inclinations at draw time (camera-only was chosen).
- 3D for the star/galaxy tiers, distance-based LOD (separate Stage 3 items).
- Browser A/B verification is Pierre's (per AGENTS.md).
