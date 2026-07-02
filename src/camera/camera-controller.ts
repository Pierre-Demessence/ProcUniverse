import type { Camera } from '@pierre/ecs/modules/camera';

import { makeCamera, viewToWorld } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

import { MAX_ZOOM, MIN_ZOOM, ORBIT_SENSITIVITY, TILT_DEFAULT, TILT_MAX, TILT_MIN, ZOOM_STEP, ZOOM_STEP_MAX, ZOOM_STREAK_MAX, ZOOM_STREAK_WINDOW_MS } from '../config/render';

export interface CameraController {
  /** Orbit azimuth (radians) for the 3D system view; ignored by the 2D path. */
  readonly azimuth: number;
  readonly camera: Camera;
  /** Polar tilt (radians) from straight-down for the 3D system view. */
  readonly tilt: number;
  dispose: () => void;
  /** Reset the 3D orbit/tilt to the default framing. */
  resetOrbit: () => void;
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
      azimuth += (bx - lastX) * ORBIT_SENSITIVITY;
      tilt = clamp(tilt + (by - lastY) * ORBIT_SENSITIVITY, TILT_MIN, TILT_MAX);
    }
    else if (panMode3D) {
      // Perspective/tilted view: map the screen drag onto the ground (z=0) plane
      // along the camera's screen axes. Screen-right on the ground is (−sin, cos)
      // of azimuth; the vertical drag runs along the horizontal view direction,
      // foreshortened by tilt (a flatter view covers more ground per pixel), so
      // the grabbed point stays under the cursor as the view rotates.
      const dxs = (bx - lastX) / camera.zoom;
      const fwd = ((by - lastY) / camera.zoom) / Math.max(Math.cos(tilt), 0.15);
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      camera.x -= dxs * -sinA + fwd * cosA;
      camera.y -= dxs * cosA + fwd * sinA;
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
    resetOrbit(): void {
      azimuth = 0;
      tilt = TILT_DEFAULT;
    },
    setThreeSystemActive(active: boolean): void {
      panMode3D = active;
    },
    get tilt() {
      return tilt;
    },
  };
}
