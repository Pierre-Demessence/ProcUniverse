import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';
import { clamp, lerp } from '@pierre/ecs/modules/math';

import { GALAXY_CELL_LY } from '../config';
import { cosmicDensity } from '../generation/galaxies';
import { AU_PER_LY } from '../generation/units';
import { populationGlow } from './galaxy-sprites';

// Grow super-cells to stay at least this many pixels wide so the draw count
// stays bounded however far out the camera goes.
const TARGET_CELL_PX = 34;

/**
 * UNIVERSE tier: aggregate the smooth cosmic-web density into a soft additive
 * glow so the largest zoom shows filaments and voids — dense clusters bright and
 * red (old spheroidals), the sparse field dim and blue. Super-cells are sized in
 * galaxy-cells and rendered relative to the floating origin. Returns glows drawn.
 */
export function drawUniverse(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  originX: number,
  originY: number,
): number {
  const galaxyCell = GALAXY_CELL_LY * AU_PER_LY;
  const cellPx = galaxyCell * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(cellPx, 1e-9))));
  const superCell = galaxyCell * (2 ** level);
  const superPx = superCell * cam.zoom;
  const rect = cameraViewRect(cam);
  const absX = rect.x + originX;
  const absY = rect.y + originY;
  const minCx = Math.floor(absX / superCell);
  const maxCx = Math.floor((absX + rect.w) / superCell);
  const minCy = Math.floor(absY / superCell);
  const maxCy = Math.floor((absY + rect.h) / superCell);

  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  let drawn = 0;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * superCell;
      const wyAbs = (cy + 0.5) * superCell;
      const cosmic = cosmicDensity(seed, Math.floor(wxAbs / galaxyCell), Math.floor(wyAbs / galaxyCell));
      if (cosmic < 0.05)
        continue;
      const v = worldToView(wxAbs - originX, wyAbs - originY, cam);
      const r = superPx * (0.4 + 0.5 * cosmic);
      const sprite = populationGlow(lerp(0.6, 0.2, cosmic));
      ctx2d.globalAlpha = clamp(0.08 + 0.4 * cosmic, 0, 0.6);
      ctx2d.drawImage(sprite, v.vx - r, v.vy - r, r * 2, r * 2);
      drawn++;
    }
  }
  ctx2d.globalAlpha = 1;
  ctx2d.restore();
  return drawn;
}
