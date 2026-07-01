import type { Camera } from '@pierre/ecs/modules/camera';

import { formatDistance } from '../distance';
import { galaxyAt, universeAge } from '../generation/galaxies';
import { distanceUnit, namingStyle } from '../settings';

const MARGIN_PX = 12;
const LINE_PX = 14;
const ABSOLUTE_COLOR = 'rgba(180, 205, 245, 0.9)';
const CONTEXT_COLOR = 'rgba(150, 175, 220, 0.7)';

/** Three significant figures with thousands separators, trailing zeros dropped. */
function threeSigFigs(value: number): string {
  return Number(value.toPrecision(3)).toLocaleString('en-US');
}

/** A signed world distance (AU) formatted in the current distance unit. */
export function formatCoord(au: number): string {
  return formatDistance(au, distanceUnit.value);
}

/**
 * Bottom-left readout of the view-centre world position: absolute coordinates
 * from the world origin (the home galaxy's centre) on top, and below them the
 * current galaxy plus the offset from its centre — or "intergalactic space" in
 * the void. Screen space, in canvas backing pixels, stacked just above the scale
 * bar to match the hint / scale-bar HUD.
 */
export function drawCoords(ctx2d: CanvasRenderingContext2D, cam: Camera, seed: number): void {
  const galaxy = galaxyAt(seed, cam.x, cam.y);
  const epoch = `Universe age ${threeSigFigs(universeAge(seed) / 1e9)} Gyr`;
  const absolute = `X ${formatCoord(cam.x)}   Y ${formatCoord(cam.y)}`;
  const context = galaxy
    ? `\u0394 ${formatCoord(cam.x - galaxy.centerX)}, ${formatCoord(cam.y - galaxy.centerY)} in ${namingStyle.value === 'human' ? galaxy.humanName : galaxy.name}`
    : 'intergalactic space';

  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  const contextY = cam.viewportH - 54;
  ctx2d.fillStyle = CONTEXT_COLOR;
  ctx2d.fillText(epoch, MARGIN_PX, contextY - 2 * LINE_PX);
  ctx2d.fillStyle = ABSOLUTE_COLOR;
  ctx2d.fillText(absolute, MARGIN_PX, contextY - LINE_PX);
  ctx2d.fillStyle = CONTEXT_COLOR;
  ctx2d.fillText(context, MARGIN_PX, contextY);
  ctx2d.restore();
}
