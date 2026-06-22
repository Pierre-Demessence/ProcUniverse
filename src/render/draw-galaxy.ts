import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

import { galaxyActivityAt, galaxyDensityAt } from '../generation/galaxies';
import { SECTOR_SIZE } from '../scale';
import { populationGlow } from './galaxy-sprites';

// Aggregate sectors into power-of-two cells so each cell stays at least this
// many screen pixels wide — that keeps the visible cell count (and therefore
// the draw count) bounded at any zoom, however far out.
const TARGET_CELL_PX = 34;

/**
 * GALAXY tier: draw a soft additive glow per aggregate cell — brightness and
 * size from the galaxy density field, colour from the star-formation activity
 * (blue arms, red cores / ellipticals) — the same fields that place and colour
 * the stars, so the zoomed-out view shows each galaxy's shape and population.
 * Cell centres are computed in absolute space (so the pattern is stable across
 * rebases) but rendered relative to the floating origin `(originX, originY)`;
 * empty cells beyond the galaxies are skipped. Cached tinted sprites are blitted
 * per cell, so cost is bounded by the on-screen cell count. Returns the glows drawn.
 */
export function drawGalaxy(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  originX: number,
  originY: number,
): number {
  const sectorPx = SECTOR_SIZE * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(sectorPx, 1e-9))));
  const cellWorld = SECTOR_SIZE * (2 ** level);
  const cellPx = cellWorld * cam.zoom;
  const rect = cameraViewRect(cam);
  const absX = rect.x + originX;
  const absY = rect.y + originY;
  const minCx = Math.floor(absX / cellWorld);
  const maxCx = Math.floor((absX + rect.w) / cellWorld);
  const minCy = Math.floor(absY / cellWorld);
  const maxCy = Math.floor((absY + rect.h) / cellWorld);
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  let drawn = 0;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * cellWorld;
      const wyAbs = (cy + 0.5) * cellWorld;
      const norm = galaxyDensityAt(seed, wxAbs, wyAbs);
      if (norm < 0.01)
        continue;
      const activity = galaxyActivityAt(seed, wxAbs, wyAbs);
      const sprite = populationGlow(activity);
      const v = worldToView(wxAbs - originX, wyAbs - originY, cam);
      const r = cellPx * (0.4 + 0.5 * norm);
      ctx2d.globalAlpha = clamp(0.1 + 0.5 * norm, 0, 0.7);
      ctx2d.drawImage(sprite, v.vx - r, v.vy - r, r * 2, r * 2);
      drawn++;
    }
  }
  ctx2d.globalAlpha = 1;
  ctx2d.restore();
  return drawn;
}
