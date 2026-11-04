import type { StarData, SystemData } from '../generation/universe';
import type { SectorCache } from './sector-cache';

import { SECTOR_SIZE } from '../scale';

/**
 * The system nearest an absolute 3D point (AU), searched in the 3×3×3 sectors
 * around the one holding it, or null if they are all empty. That covers every
 * star within one sector edge of the point, so a nearer star just across a
 * sector face is found.
 */
export function nearestSystem(cache: Pick<SectorCache, 'get' | 'system'>, camX: number, camY: number, camZ: number): SystemData | null {
  const sx = Math.floor(camX / SECTOR_SIZE);
  const sy = Math.floor(camY / SECTOR_SIZE);
  const sz = Math.floor(camZ / SECTOR_SIZE);
  let best: StarData | null = null;
  let bestDist = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const star of cache.get(sx + dx, sy + dy, sz + dz).stars) {
          const d = (star.x - camX) ** 2 + (star.y - camY) ** 2 + (star.z - camZ) ** 2;
          if (d < bestDist) {
            bestDist = d;
            best = star;
          }
        }
      }
    }
  }
  return best && cache.system(best);
}
