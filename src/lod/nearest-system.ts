import type { SystemData } from '../generation/universe';
import type { SectorCache } from './sector-cache';

import { SECTOR_SIZE } from '../scale';

/**
 * The system nearest an absolute 3D point (AU) within the sector holding it,
 * or null if that sector is empty.
 */
export function nearestSystem(cache: Pick<SectorCache, 'get'>, camX: number, camY: number, camZ: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  const sz = Math.floor(camZ / SECTOR_SIZE);
  let best: SystemData | null = null;
  let bestDist = Infinity;
  for (const sys of cache.get(sx, sy, sz).systems) {
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
