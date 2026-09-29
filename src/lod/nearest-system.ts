import type { SystemData } from '../generation/universe';
import type { SectorCache } from './sector-cache';

import { SECTOR_SIZE } from '../scale';

/** The system nearest an absolute position within its sector, or null if the sector is empty. */
export function nearestSystem(cache: Pick<SectorCache, 'get'>, camX: number, camY: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  let best: SystemData | null = null;
  let bestDist = Infinity;
  for (const sys of cache.get(sx, sy).systems) {
    const dx = sys.x - camX;
    const dy = sys.y - camY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = sys;
    }
  }
  return best;
}
