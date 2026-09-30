import type { SystemData } from '../generation/universe';
import type { SectorCache } from './sector-cache';

import { SECTOR_SIZE } from '../scale';

/**
 * The system nearest an absolute 3D point (AU) within the sector holding its
 * `(x, y)`, or null if that sector is empty. Distance includes each system's
 * height `z`, so a star far above the focus loses to one level with it.
 */
export function nearestSystem(cache: Pick<SectorCache, 'get'>, camX: number, camY: number, camZ: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  let best: SystemData | null = null;
  let bestDist = Infinity;
  for (const sys of cache.get(sx, sy).systems) {
    const dx = sys.x - camX;
    const dy = sys.y - camY;
    const dz = sys.z - camZ;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = sys;
    }
  }
  return best;
}
