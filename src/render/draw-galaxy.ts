import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

import { galaxyDensity, getGalaxy } from '../generation/galaxies';
import { SECTOR_SIZE } from '../scale';

// Aggregate sectors into power-of-two cells so each cell stays at least this
// many screen pixels wide — that keeps the visible cell count (and therefore
// the draw count) bounded at any zoom, however far out.
const TARGET_CELL_PX = 34;

let glowSprite: HTMLCanvasElement | null = null;

function glow(): HTMLCanvasElement {
  if (glowSprite)
    return glowSprite;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(170, 195, 255, 1)');
  grad.addColorStop(0.45, 'rgba(140, 170, 255, 0.4)');
  grad.addColorStop(1, 'rgba(120, 150, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowSprite = c;
  return c;
}

/**
 * GALAXY tier: draw a soft additive glow per aggregate cell, brightness and size
 * scaled by the galaxy density field at the cell centre — the same field that
 * places the stars, so the zoomed-out glow shows the galaxy's core and arms.
 * Cell centres are computed in absolute space (so the pattern is stable across
 * rebases) but rendered relative to the floating origin `(originX, originY)`;
 * empty cells beyond the galaxy are skipped. A cached gradient sprite is blitted
 * per cell, so cost is bounded by the on-screen cell count. Returns the number
 * of glows drawn.
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
  const sprite = glow();
  const galaxy = getGalaxy(seed);

  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  let drawn = 0;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wxAbs = (cx + 0.5) * cellWorld;
      const wyAbs = (cy + 0.5) * cellWorld;
      const norm = galaxyDensity(galaxy, wxAbs, wyAbs);
      if (norm < 0.01)
        continue;
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
