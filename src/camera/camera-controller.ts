import type { Camera } from '@pierre/ecs/modules/camera';

import { makeCamera } from '@pierre/ecs/modules/camera';
import { projectPointer } from '@pierre/ecs/modules/input';
import { clamp, wrap } from '@pierre/ecs/modules/math';

import { FLAT_TILT, MAX_ZOOM, MIN_ZOOM, ORBIT_SENSITIVITY, TILT_DEFAULT, ZOOM_STEP, ZOOM_STEP_MAX, ZOOM_STREAK_MAX, ZOOM_STREAK_WINDOW_MS } from '../config/render';
import { GALACTIC_NORMAL, planeBasis } from './plane-basis';

/** A render-origin-frame point (AU). */
export interface ZoomTarget {
  x: number;
  y: number;
  z: number;
}

/**
 * Resolves the 3D point a wheel zoom should close in on for a cursor position
 * (backing px), or null to zoom about the focus instead.
 */
export type ZoomTargetResolver = (bx: number, by: number) => ZoomTarget | null;

export interface CameraController {
  /** Orbit azimuth (radians) around the reference plane's normal. */
  readonly azimuth: number;
  readonly camera: Camera;
  /** Whether the flat (top-down) view override is active. */
  readonly flat: boolean;
  /** Height (z) of the camera focus; moved by the pan and lock. */
  readonly focusZ: number;
  /** Polar tilt (radians, wrapped to [0, 2π)) from straight down the reference plane's normal. */
  readonly tilt: number;
  dispose: () => void;
  /** Reset the 3D orbit/tilt (and focus height) to the default framing. */
  resetOrbit: () => void;
  /** Restore the 3D orbit state from a persisted session (azimuth rad, tilt rad, focusZ AU). */
  restoreOrbit: (azimuth: number, tilt: number, focusZ: number) => void;
  /**
   * Toggle the flat (top-down) view: reports a straight-down tilt (looking down
   * the reference plane's normal) and ignores tilt input, without mutating the
   * stored tilt — so clearing it restores the prior view.
   */
  setFlat: (flat: boolean) => void;
  /** Set the 3D camera focus height (z), e.g. when locking onto an off-plane body. */
  setFocusZ: (z: number) => void;
  /**
   * Set the reference plane's unit normal (the focused disk, the host galaxy's
   * disk, or world +z, see `referencePlaneNormal`), so the pan slides along the
   * tilted / orbited plane in true screen space (matching the plane-anchored
   * render camera). Defaults to the world +z axis.
   */
  setReferencePlane: (nx: number, ny: number, nz: number) => void;
  /** Install (or clear) the 3D zoom-to-point resolver used by the wheel. */
  setZoomTargetResolver: (resolver: ZoomTargetResolver | null) => void;
}

/**
 * Free-floating orbit / pan / zoom controller over a plain engine `Camera` (whose
 * `zoom` is px per AU at the focus). Right-drag orbits and tilts around the
 * reference plane; left-drag pans along it (content follows the cursor); the
 * wheel zooms toward the 3D point under the pointer. All math runs in canvas
 * backing pixels, so `camera.viewportW/H` must track `canvas.width/height` (the
 * owner keeps them in sync on resize).
 */
export function createCameraController(canvas: HTMLCanvasElement): CameraController {
  const camera = makeCamera({
    viewportH: canvas.height,
    viewportW: canvas.width,
    x: 0,
    y: 0,
    zoom: 1,
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // Orbit: right-drag rotates (azimuth) and tilts (polar angle); left-drag pans.
  let azimuth = 0;
  let tilt = TILT_DEFAULT;
  let orbiting = false;
  // Flat (top-down) override: reports a straight-down tilt (looking down the
  // reference plane's normal) and ignores tilt input, without mutating the
  // stored tilt — so clearing it restores the prior view.
  let flat = false;
  const effectiveTilt = (): number => (flat ? FLAT_TILT : tilt);
  let zoomTarget: ZoomTargetResolver | null = null;
  // The reference plane's basis in world space: the unit normal N and two
  // in-plane axes (u, v). The render camera is anchored to this plane, so the
  // pan slides the focus along it in true screen space. `focusZ` is the focus's
  // height, moved by that pan (and by locking onto an off-plane body). Defaults
  // to the world +z plane.
  const initial = planeBasis(GALACTIC_NORMAL);
  let [planeNx, planeNy, planeNz] = initial.n;
  let [planeUx, planeUy, planeUz] = initial.u;
  let [planeVx, planeVy, planeVz] = initial.v;
  let focusZ = 0;

  // Accelerating zoom: rapid same-direction notches build a streak that ramps
  // the per-notch factor; a pause or direction flip resets it.
  let wheelStreak = 0;
  let lastWheelMs = 0;
  let lastWheelDir = 0;

  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    orbiting = e.button === 2;
    const { x: bx, y: by } = projectPointer(e, canvas);
    lastX = bx;
    lastY = by;
    canvas.style.cursor = orbiting ? 'move' : 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging)
      return;
    const { x: bx, y: by } = projectPointer(e, canvas);
    if (orbiting) {
      // Horizontal drag spins the view (azimuth) in both modes; vertical drag
      // tilts only when NOT flat — flatten locks the top-down tilt while still
      // letting you pivot the map around its centre. The stored tilt is untouched
      // while flat, so clearing flat restores it. Tilt is unbounded (trackball
      // style: over the pole, under the disk and back round), wrapped to one turn.
      azimuth += (bx - lastX) * ORBIT_SENSITIVITY;
      if (!flat)
        tilt = wrap(tilt + (by - lastY) * ORBIT_SENSITIVITY, 0, 2 * Math.PI);
    }
    else {
      // Plane-anchored perspective view: slide the focus in true screen space so
      // the grabbed point tracks the cursor at any orbit angle. R (screen-right)
      // and U (screen-up) are the render camera's world axes expressed in the
      // reference-plane basis; moving the focus by −dxs·R + dys·U keeps the point
      // under the cursor. The focus is a full 3D point (x, y on the camera, z in
      // `focusZ`), so a plane tilted in space pans correctly rather than only in x,y.
      const cosA = Math.cos(azimuth);
      const sinA = Math.sin(azimuth);
      const cosT = Math.cos(effectiveTilt());
      const sinT = Math.sin(effectiveTilt());
      // R = −sinA·u + cosA·v; U = sinT·N − cosT·(cosA·u + sinA·v).
      const rx = -sinA * planeUx + cosA * planeVx;
      const ry = -sinA * planeUy + cosA * planeVy;
      const rz = -sinA * planeUz + cosA * planeVz;
      const px = cosA * planeUx + sinA * planeVx;
      const py = cosA * planeUy + sinA * planeVy;
      const pz = cosA * planeUz + sinA * planeVz;
      const upx = sinT * planeNx - cosT * px;
      const upy = sinT * planeNy - cosT * py;
      const upz = sinT * planeNz - cosT * pz;
      const dxs = (bx - lastX) / camera.zoom;
      const dys = (by - lastY) / camera.zoom;
      camera.x -= dxs * rx - dys * upx;
      camera.y -= dxs * ry - dys * upy;
      focusZ -= dxs * rz - dys * upz;
    }
    lastX = bx;
    lastY = by;
  };

  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    canvas.style.cursor = 'grab';
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x: bx, y: by } = projectPointer(e, canvas);

    // Ramp the per-notch factor from ZOOM_STEP up to ZOOM_STEP_MAX as rapid
    // same-direction notches accumulate, so crossing the ~10¹² zoom range is a
    // quick flick instead of ~240 notches. A gap over the chaining window or a
    // direction change resets the streak, restoring the gentle step for fine
    // control.
    const now = performance.now();
    const dir = e.deltaY < 0 ? 1 : -1;
    wheelStreak = now - lastWheelMs > ZOOM_STREAK_WINDOW_MS || dir !== lastWheelDir
      ? 0
      : Math.min(wheelStreak + 1, ZOOM_STREAK_MAX);
    lastWheelMs = now;
    lastWheelDir = dir;
    const stepMag = ZOOM_STEP * (ZOOM_STEP_MAX / ZOOM_STEP) ** (wheelStreak / ZOOM_STREAK_MAX);
    const factor = dir > 0 ? stepMag : 1 / stepMag;

    // 3D zoom-to-point: dolly the focus toward the target so it stays under the
    // cursor (the camera sits at focus + distance·dir and distance ∝ 1/zoom, so
    // scaling the focus→target offset by the zoom ratio keeps the camera on the
    // target's line of sight). Zooming onto a star converges on it in x, y AND z.
    const target = zoomTarget?.(bx, by);
    if (target) {
      const oldZoom = camera.zoom;
      camera.zoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
      const keep = oldZoom / camera.zoom;
      camera.x = target.x + (camera.x - target.x) * keep;
      camera.y = target.y + (camera.y - target.y) * keep;
      focusZ = target.z + (focusZ - target.z) * keep;
      return;
    }

    // No 3D point under the cursor (e.g. a ray grazing the horizon): zoom about the focus.
    camera.zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  };

  // Right-drag orbits the 3D view; suppress the context menu so it can.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    camera,
    get azimuth() {
      return azimuth;
    },
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
    get flat() {
      return flat;
    },
    get focusZ() {
      return focusZ;
    },
    resetOrbit(): void {
      azimuth = 0;
      tilt = TILT_DEFAULT;
      focusZ = 0;
    },
    restoreOrbit(az: number, ti: number, fz: number): void {
      azimuth = az;
      tilt = Number.isFinite(ti) ? wrap(ti, 0, 2 * Math.PI) : TILT_DEFAULT;
      focusZ = Number.isFinite(fz) ? fz : 0;
    },
    setFlat(next: boolean): void {
      flat = next;
    },
    setFocusZ(z: number): void {
      focusZ = z;
    },
    setReferencePlane(nx: number, ny: number, nz: number): void {
      planeNx = nx;
      planeNy = ny;
      planeNz = nz;
      // The same basis the render camera orbits in.
      const { u, v } = planeBasis([nx, ny, nz]);
      [planeUx, planeUy, planeUz] = u;
      [planeVx, planeVy, planeVz] = v;
    },
    setZoomTargetResolver(resolver: ZoomTargetResolver | null): void {
      zoomTarget = resolver;
    },
    get tilt() {
      return effectiveTilt();
    },
  };
}
