import type { Camera } from '@pierre/ecs/modules/camera';

import { SCALE_KM_BELOW_AU, SCALE_LY_ABOVE_AU } from '../config';
import { auToKm, auToLy } from '../generation/units';
import { niceStep, TARGET_PX } from './grid';

const MARGIN_PX = 12;
const TICK_PX = 5;
const COLOR = 'rgba(170, 200, 245, 0.8)';

/**
 * Draw a map-style scale bar in the bottom-left, exactly one reference-grid cell
 * wide and labelled with that cell's real length. Reuses the grid's `niceStep`
 * so the bar and the visible grid always agree; the unit auto-selects km / AU /
 * ly by magnitude. Screen-space, in canvas backing pixels (like the hint).
 */
export function drawScaleBar(ctx2d: CanvasRenderingContext2D, cam: Camera): void {
  const cellAu = niceStep(TARGET_PX / cam.zoom);
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
  ctx2d.fillText(formatScaleLength(cellAu), x0, y - TICK_PX - 2);
  ctx2d.restore();
}

/** A grid-cell length in AU as a friendly `value unit` string (km / Mkm / AU / ly). */
function formatScaleLength(au: number): string {
  if (au < SCALE_KM_BELOW_AU) {
    const km = auToKm(au);
    return km >= 1e6 ? `${threeSigFigs(km / 1e6)} Mkm` : `${threeSigFigs(km)} km`;
  }
  if (au < SCALE_LY_ABOVE_AU)
    return `${threeSigFigs(au)} AU`;
  return `${threeSigFigs(auToLy(au))} ly`;
}

/** Three significant figures with thousands separators, trailing zeros dropped. */
function threeSigFigs(x: number): string {
  return Number(x.toPrecision(3)).toLocaleString('en-US');
}
