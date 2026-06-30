import type { Camera } from '@pierre/ecs/modules/camera';

import { auToUnit, formatDistance, unitToAu } from '../distance';
import { distanceUnit } from '../settings';
import { niceStep, TARGET_PX } from './grid';

const MARGIN_PX = 12;
const TICK_PX = 5;
const COLOR = 'rgba(170, 200, 245, 0.8)';

/**
 * Draw a map-style scale bar in the bottom-left, exactly one reference-grid cell
 * wide and labelled with that cell's real length in the chosen distance unit.
 * Adaptive auto-selects km / AU / ly by magnitude; a fixed unit rounds the cell
 * to a nice value in that unit so the label reads cleanly. Reuses the grid's
 * `niceStep` so the bar and the visible grid agree. Screen-space backing pixels.
 */
export function drawScaleBar(ctx2d: CanvasRenderingContext2D, cam: Camera): void {
  const unit = distanceUnit.value;
  const targetAu = TARGET_PX / cam.zoom;
  // Round the cell to a nice length: in the chosen unit when fixed (so the label
  // is a clean number like "200 km"), or in AU when adaptive.
  const cellAu = unit === 'adaptive' ? niceStep(targetAu) : unitToAu(niceStep(auToUnit(targetAu, unit)), unit);
  const barPx = cellAu * cam.zoom;
  const x0 = MARGIN_PX;
  const y = cam.viewportH - 30;

  ctx2d.save();
  ctx2d.strokeStyle = COLOR;
  ctx2d.fillStyle = COLOR;
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath();
  ctx2d.moveTo(x0, y - TICK_PX);
  ctx2d.lineTo(x0, y);
  ctx2d.lineTo(x0 + barPx, y);
  ctx2d.lineTo(x0 + barPx, y - TICK_PX);
  ctx2d.stroke();

  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(formatDistance(cellAu, unit), x0, y - TICK_PX - 2);
  ctx2d.restore();
}
