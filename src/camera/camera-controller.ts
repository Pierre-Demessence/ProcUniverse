import type { Camera } from '@pierre/ecs/modules/camera';

import { makeCamera, viewToWorld } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

import { FLAT_TILT, MAX_ZOOM, MIN_ZOOM, ORBIT_SENSITIVITY, TILT_DEFAULT, TILT_MAX, TILT_MIN, ZOOM_STEP, ZOOM_STEP_MAX, ZOOM_STREAK_MAX, ZOOM_STREAK_WINDOW_MS } from '../config/render';

export interface CameraController {
  /** Orbit azimuth (radians) for the 3D system view; ignored by the 2D path. */
  readonly azimuth: number;
  readonly camera: Camera;
  /** Whether the flat (top-down) view override is active. */
  readonly flat: boolean;
  /** Out-of-plane height (z) of the 3D camera focus; moved by the 3D pan and lock. */
  readonly focusZ: number;
  /** Polar tilt (radians) from straight-down for the 3D system view. */
  readonly tilt: number;
  dispose: () => void;
  /** Reset the 3D orbit/tilt (and focus height) to the default framing. */
  resetOrbit: () => void;
  /**
   * Toggle the flat (top-down) view: reports a near-straight-down tilt (looking
   * down the focused system's plane, so orbits read as circles) and ignores
   * orbit input, without mutating the stored tilt — so clearing it restores the
   * prior view.
   */
  setFlat: (flat: boolean) => void;
  /** Set the 3D camera focus height (z), e.g. when locking onto an off-plane body. */
  setFocusZ: (z: number) => void;
  /**
   * Set the focused system's orbital-plane unit normal, so the 3D pan slides
   * along that plane in true screen space (matching the plane-anchored render
   * camera). Defaults to the world +z axis until a system is focused.
   */
  setSystemPlane: (nx: number, ny: number, nz: number) => void;
  /**
   * Toggle 3D system-view panning: when active a left-drag pans along the
   * tilted/orbited ground plane instead of the raw 2D screen axes.
   */
  setThreeSystemActive: (active: boolean) => void;
}

/**
 * Free-floating pan/zoom controller over a plain engine `Camera`. Drag pans
 * (content follows the cursor); the wheel zooms toward the pointer, keeping the
 * world point under the cursor fixed. All math runs in canvas backing pixels,
 * so `camera.viewportW/H` must track `canvas.width/height` (the owner keeps
 * them in sync on resize).
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

  // 3D system-view orbit: right-drag rotates (azimuth) and tilts (polar angle);
  // left-drag still pans. Only the Three system tier reads these.
  let azimuth = 0;
  let tilt = TILT_DEFAULT;
  let orbiting = false;
  let panMode3D = false;
  // Flat (top-down) override: reports a near-straight-down tilt (looking down the
  // focused system's plane, so orbits read as circles) and ignores orbit input,
  // without mutating the stored tilt — so clearing it restores the prior view.
  let flat = false;
  const effectiveTilt = (): number => (flat ? FLAT_TILT : tilt);
  // The focused system's orbital-plane basis in world space: the unit normal N
  // and two in-plane axes (u, v). The render camera is anchored to this plane, so
  // the 3D pan slides the focus along it in true screen space. `focusZ` is the
  // focus's out-of-plane height, moved by that pan (and by locking onto an
  // off-plane body). Defaults to the world +z plane (u = x̂, v = ŷ).
  let planeNx = 0;
  let planeNy = 0;
  let planeNz = 1;
  let planeUx = 1;
  let planeUy = 0;
  let planeUz = 0;
  let planeVx = 0;
  let planeVy = 1;
  let planeVz = 0;
  let focusZ = 0;

  // Accelerating zoom: rapid same-direction notches build a streak that ramps
  // the per-notch factor; a pause or direction flip resets it.
  let wheelStreak = 0;
  let lastWheelMs = 0;
  let lastWheelDir = 0;

  // Client (CSS-pixel) coords → canvas backing pixels, the space the camera
  // transforms operate in.
  const toBacking = (clientX: number, clientY: number): { bx: number; by: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      bx: (clientX - rect.left) * (canvas.width / rect.width),
      by: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    orbiting = e.button === 2;
    const { bx, by } = toBacking(e.clientX, e.clientY);
    lastX = bx;
    lastY = by;
    canvas.style.cursor = orbiting ? 'move' : 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging)
      return;
    const { bx, by } = toBacking(e.clientX, e.clientY);
    if (orbiting) {
      // Horizontal drag spins the view (azimuth) in both modes; vertical drag
      // tilts only when NOT flat — flatten locks the top-down tilt while still
      // letting you pivot the map around its centre. The stored tilt is untouched
      // while flat, so clearing flat restores it.
      azimuth += (bx - lastX) * ORBIT_SENSITIVITY;
      if (!flat)
        tilt = clamp(tilt + (by - lastY) * ORBIT_SENSITIVITY, TILT_MIN, TILT_MAX);
    }
    else if (panMode3D) {
      // Plane-anchored perspective view: slide the focus in true screen space so
      // the grabbed point tracks the cursor at any orbit angle. R (screen-right)
      // and U (screen-up) are the render camera's world axes expressed in the disk
      // basis; moving the focus by −dxs·R + dys·U keeps the point under the cursor.
      // The focus is a full 3D point (x, y on the 2D camera, z in `focusZ`), so a
      // disk tilted in space pans correctly rather than only in x,y.
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
    else {
      camera.x -= (bx - lastX) / camera.zoom;
      camera.y -= (by - lastY) / camera.zoom;
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
    const { bx, by } = toBacking(e.clientX, e.clientY);
    const before = viewToWorld(bx, by, camera);

    // Ramp the per-notch factor from ZOOM_STEP up to ZOOM_STEP_MAX as rapid
    // same-direction notches accumulate, so crossing the ~10¹² zoom range is a
    // quick flick instead of ~240 notches. A gap over the chaining window or a
    // direction change resets the streak, restoring the gentle step for fine
    // control. The cursor-pin math below is unchanged.
    const now = performance.now();
    const dir = e.deltaY < 0 ? 1 : -1;
    wheelStreak = now - lastWheelMs > ZOOM_STREAK_WINDOW_MS || dir !== lastWheelDir
      ? 0
      : Math.min(wheelStreak + 1, ZOOM_STREAK_MAX);
    lastWheelMs = now;
    lastWheelDir = dir;
    const stepMag = ZOOM_STEP * (ZOOM_STEP_MAX / ZOOM_STEP) ** (wheelStreak / ZOOM_STREAK_MAX);
    const factor = dir > 0 ? stepMag : 1 / stepMag;

    camera.zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = viewToWorld(bx, by, camera);
    // Re-pin the pre-zoom world point under the cursor.
    camera.x += before.wx - after.wx;
    camera.y += before.wy - after.wy;
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
    setFlat(next: boolean): void {
      flat = next;
    },
    setFocusZ(z: number): void {
      focusZ = z;
    },
    setSystemPlane(nx: number, ny: number, nz: number): void {
      planeNx = nx;
      planeNy = ny;
      planeNz = nz;
      // Seed an in-plane basis: u = ref × N with ref = ẑ unless N is nearly
      // vertical (then ref = x̂), matching the render camera's basis choice.
      const refZ = Math.abs(nz) < 0.999 ? 1 : 0;
      const refX = refZ === 1 ? 0 : 1;
      let ux = -refZ * ny;
      let uy = refZ * nx - refX * nz;
      let uz = refX * ny;
      const ulen = Math.hypot(ux, uy, uz) || 1;
      ux /= ulen;
      uy /= ulen;
      uz /= ulen;
      planeUx = ux;
      planeUy = uy;
      planeUz = uz;
      // v = N × u (unit, since N ⟂ u are orthonormal).
      planeVx = ny * uz - nz * uy;
      planeVy = nz * ux - nx * uz;
      planeVz = nx * uy - ny * ux;
    },
    setThreeSystemActive(active: boolean): void {
      panMode3D = active;
    },
    get tilt() {
      return effectiveTilt();
    },
  };
}
