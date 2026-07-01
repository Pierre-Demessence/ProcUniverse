import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';

import { GALAXY_SPRITE_SCALE } from '../config/render';
import { galaxiesInRect, galaxyRepresentativeActivity } from '../generation/galaxies';
import { namingStyle } from '../settings';
import { populationGlow } from './galaxy-sprites';

// A galaxy's catalogue label is drawn once its sprite is at least this wide (px).
const LABEL_MIN_PX = 22;
const LABEL_FILL = 'rgba(210, 224, 255, 0.85)';
const MIN_SPRITE_PX = 2;

/**
 * GALAXY-FIELD tier: each galaxy in view as a tinted additive sprite (size from
 * its radius, colour from its dominant stellar population) plus its `NGC-…`
 * label once the sprite is large enough. Iterating the visible galaxy cells is
 * bounded because this tier spans a fixed zoom band. Returns the galaxies drawn.
 */
export function drawGalaxyField(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  originX: number,
  originY: number,
): number {
  const rect = cameraViewRect(cam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;
  const galaxies = [...galaxiesInRect(seed, minX, minY, minX + rect.w, minY + rect.h)];

  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  let drawn = 0;
  for (const g of galaxies) {
    const radiusPx = Math.max(MIN_SPRITE_PX, g.radius * cam.zoom * GALAXY_SPRITE_SCALE);
    const v = worldToView(g.centerX - originX, g.centerY - originY, cam);
    const sprite = populationGlow(galaxyRepresentativeActivity(g));
    ctx2d.globalAlpha = 0.9;
    ctx2d.drawImage(sprite, v.vx - radiusPx, v.vy - radiusPx, radiusPx * 2, radiusPx * 2);
    drawn++;
  }
  ctx2d.globalAlpha = 1;
  ctx2d.restore();

  // Labels in a second opaque pass so the additive sprites don't wash them out.
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = LABEL_FILL;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  for (const g of galaxies) {
    const radiusPx = g.radius * cam.zoom * GALAXY_SPRITE_SCALE;
    if (radiusPx * 2 < LABEL_MIN_PX)
      continue;
    const v = worldToView(g.centerX - originX, g.centerY - originY, cam);
    ctx2d.fillText(namingStyle.value === 'human' ? g.humanName : g.name, v.vx, v.vy + radiusPx + 3);
  }
  ctx2d.restore();
  return drawn;
}
