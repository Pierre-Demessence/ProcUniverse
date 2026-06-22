import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';

export const TARGET_PX = 90;
const MINOR = 'rgba(120, 150, 220, 0.10)';
const AXIS = 'rgba(140, 180, 255, 0.40)';

/** Round a raw spacing up to the nearest 1/2/5 x 10^k for a stable grid. */
export function niceStep(raw: number): number {
  if (!(raw > 0))
    return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const nice = frac < 2 ? 2 : frac < 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Draw an adaptive world-space reference grid so panning and zooming are
 * visible on an otherwise empty plane. The step rescales with zoom (1/2/5
 * decades), so the on-screen line count stays bounded at any magnification.
 * Lines are placed at ABSOLUTE world multiples (then projected through the
 * floating render origin), so the grid stays continuous across rebases; the
 * bright axes mark the true world `(0, 0)`.
 */
export function drawReferenceGrid(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  originX: number,
  originY: number,
): void {
  const rect = cameraViewRect(cam);
  const absX = rect.x + originX;
  const absY = rect.y + originY;
  const step = niceStep(TARGET_PX / cam.zoom);

  ctx2d.save();
  ctx2d.lineWidth = 1;

  ctx2d.strokeStyle = MINOR;
  ctx2d.beginPath();
  for (let wx = Math.floor(absX / step) * step; wx <= absX + rect.w; wx += step) {
    const x = Math.round(worldToView(wx - originX, rect.y, cam).vx) + 0.5;
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, cam.viewportH);
  }
  for (let wy = Math.floor(absY / step) * step; wy <= absY + rect.h; wy += step) {
    const y = Math.round(worldToView(rect.x, wy - originY, cam).vy) + 0.5;
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(cam.viewportW, y);
  }
  ctx2d.stroke();

  // Highlight the true world axes (x=0 / y=0), projected through the origin.
  const axes = worldToView(-originX, -originY, cam);
  ctx2d.strokeStyle = AXIS;
  ctx2d.beginPath();
  ctx2d.moveTo(Math.round(axes.vx) + 0.5, 0);
  ctx2d.lineTo(Math.round(axes.vx) + 0.5, cam.viewportH);
  ctx2d.moveTo(0, Math.round(axes.vy) + 0.5);
  ctx2d.lineTo(cam.viewportW, Math.round(axes.vy) + 0.5);
  ctx2d.stroke();

  ctx2d.restore();
}
