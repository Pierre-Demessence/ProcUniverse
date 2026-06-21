import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';

const TARGET_PX = 90;
const MINOR = 'rgba(120, 150, 220, 0.10)';
const AXIS = 'rgba(140, 180, 255, 0.40)';

/** Round a raw spacing up to the nearest 1/2/5 x 10^k for a stable grid. */
function niceStep(raw: number): number {
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
 */
export function drawReferenceGrid(ctx2d: CanvasRenderingContext2D, cam: Camera): void {
  const rect = cameraViewRect(cam);
  const step = niceStep(TARGET_PX / cam.zoom);

  ctx2d.save();
  ctx2d.lineWidth = 1;

  ctx2d.strokeStyle = MINOR;
  ctx2d.beginPath();
  for (let wx = Math.floor(rect.x / step) * step; wx <= rect.x + rect.w; wx += step) {
    const x = Math.round(worldToView(wx, rect.y, cam).vx) + 0.5;
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, cam.viewportH);
  }
  for (let wy = Math.floor(rect.y / step) * step; wy <= rect.y + rect.h; wy += step) {
    const y = Math.round(worldToView(rect.x, wy, cam).vy) + 0.5;
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(cam.viewportW, y);
  }
  ctx2d.stroke();

  // Highlight the world axes through the origin.
  const origin = worldToView(0, 0, cam);
  ctx2d.strokeStyle = AXIS;
  ctx2d.beginPath();
  ctx2d.moveTo(Math.round(origin.vx) + 0.5, 0);
  ctx2d.lineTo(Math.round(origin.vx) + 0.5, cam.viewportH);
  ctx2d.moveTo(0, Math.round(origin.vy) + 0.5);
  ctx2d.lineTo(cam.viewportW, Math.round(origin.vy) + 0.5);
  ctx2d.stroke();

  ctx2d.restore();
}
