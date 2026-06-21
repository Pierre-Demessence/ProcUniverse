import type { Camera } from '@pierre/ecs/modules/camera';

import { worldToView } from '@pierre/ecs/modules/camera';

import type { SectorCache } from '../lod/sector-cache';
import type { SectorRange } from '../lod/tier';

const TAU = Math.PI * 2;
const MIN_DOT = 1.1;
const SQUARE_BELOW = 1.6;

/**
 * STAR tier: draw each system in the visible sectors as a single dot, sized by
 * the star's radius at the current zoom (a small square when sub-pixel, a disc
 * otherwise). No planets or orbits. Returns the number of dots drawn.
 */
export function drawStars(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  cache: SectorCache,
  range: SectorRange,
): number {
  let drawn = 0;
  ctx2d.save();
  for (let sy = range.minSy; sy <= range.maxSy; sy++) {
    for (let sx = range.minSx; sx <= range.maxSx; sx++) {
      const data = cache.get(sx, sy);
      for (const sys of data.systems) {
        const v = worldToView(sys.x, sys.y, cam);
        if (v.vx < -4 || v.vx > cam.viewportW + 4 || v.vy < -4 || v.vy > cam.viewportH + 4)
          continue;
        const r = Math.max(MIN_DOT, sys.radius * cam.zoom);
        ctx2d.fillStyle = sys.color;
        if (r <= SQUARE_BELOW) {
          ctx2d.fillRect(v.vx - r, v.vy - r, r * 2, r * 2);
        }
        else {
          ctx2d.beginPath();
          ctx2d.arc(v.vx, v.vy, r, 0, TAU);
          ctx2d.fill();
        }
        drawn++;
      }
    }
  }
  ctx2d.restore();
  return drawn;
}
