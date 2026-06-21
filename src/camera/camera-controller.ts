import type { Camera } from '@pierre/ecs/modules/camera';

import { makeCamera, viewToWorld } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

// Zoom is pixels per AU. The range spans close planet inspection down to a
// galaxy-scale field; the wide span is the cost of a true astronomical scale.
const MIN_ZOOM = 1e-8;
const MAX_ZOOM = 1e4;
const ZOOM_STEP = 1.12;

export interface CameraController {
  readonly camera: Camera;
  dispose: () => void;
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
    const { bx, by } = toBacking(e.clientX, e.clientY);
    lastX = bx;
    lastY = by;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging)
      return;
    const { bx, by } = toBacking(e.clientX, e.clientY);
    camera.x -= (bx - lastX) / camera.zoom;
    camera.y -= (by - lastY) / camera.zoom;
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
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    camera.zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = viewToWorld(bx, by, camera);
    // Re-pin the pre-zoom world point under the cursor.
    camera.x += before.wx - after.wx;
    camera.y += before.wy - after.wy;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    camera,
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
