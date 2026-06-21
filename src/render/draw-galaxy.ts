import type { Camera } from '@pierre/ecs/modules/camera';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';
import { clamp } from '@pierre/ecs/modules/math';

import { hashSector } from '../generation/hash';
import { SECTOR_SIZE } from '../generation/universe';

// Aggregate sectors into power-of-two cells so each cell stays at least this
// many screen pixels wide — that keeps the visible cell count (and therefore
// the draw count) bounded at any zoom, however far out.
const TARGET_CELL_PX = 34;
const DENSITY_SALT = 0x5BD1E995;

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
 * GALAXY tier: draw a soft additive glow per aggregate cell, brightness and
 * size scaled by an estimated star density (a hashed value, since descending to
 * count real systems is infeasible this far out). A cached gradient sprite is
 * blitted per cell, so cost is bounded by the on-screen cell count. Returns the
 * number of glows drawn.
 */
export function drawGalaxy(ctx2d: CanvasRenderingContext2D, cam: Camera, seed: number): number {
  const sectorPx = SECTOR_SIZE * cam.zoom;
  const level = Math.max(0, Math.ceil(Math.log2(TARGET_CELL_PX / Math.max(sectorPx, 1e-9))));
  const cellWorld = SECTOR_SIZE * (2 ** level);
  const cellPx = cellWorld * cam.zoom;
  const rect = cameraViewRect(cam);
  const minCx = Math.floor(rect.x / cellWorld);
  const maxCx = Math.floor((rect.x + rect.w) / cellWorld);
  const minCy = Math.floor(rect.y / cellWorld);
  const maxCy = Math.floor((rect.y + rect.h) / cellWorld);
  const sprite = glow();

  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  let drawn = 0;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const d01 = hashSector(seed ^ DENSITY_SALT, cx, cy) / 4294967296;
      const norm = 0.3 + 0.7 * d01;
      const wx = (cx + 0.5) * cellWorld;
      const wy = (cy + 0.5) * cellWorld;
      const v = worldToView(wx, wy, cam);
      const r = cellPx * (0.35 + 0.4 * norm);
      ctx2d.globalAlpha = clamp(0.06 + 0.3 * norm, 0, 0.6);
      ctx2d.drawImage(sprite, v.vx - r, v.vy - r, r * 2, r * 2);
      drawn++;
    }
  }
  ctx2d.globalAlpha = 1;
  ctx2d.restore();
  return drawn;
}
