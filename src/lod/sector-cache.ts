import type { SectorData } from '../generation/universe';

import { generateSectorData } from '../generation/universe';

/** Default sector capacity: well above the most sectors any view keeps in range. */
export const SECTOR_CACHE_CAPACITY = 2048;

/**
 * Generate-on-demand cache of deterministic `SectorData`, keyed by sector
 * coordinates. Because generation is a pure function of `(seed, sx, sy, sz)`, a
 * cache miss is cheap to fill and an evicted sector regenerates identically.
 * Least-recently-read eviction keeps memory bounded: every `get` / `peek` hit
 * refreshes a sector, so the sectors in view (read every frame) are never the
 * ones evicted while they fit the capacity, which comfortably exceeds the
 * worst-case visible-sector count at the star tier.
 */
export class SectorCache {
  private readonly capacity: number;
  private readonly map = new Map<string, SectorData>();
  private readonly seed: number;

  constructor(seed: number, capacity = SECTOR_CACHE_CAPACITY) {
    this.seed = seed;
    this.capacity = capacity;
  }

  get(sx: number, sy: number, sz: number): SectorData {
    const key = `${sx},${sy},${sz}`;
    let data = this.touch(key);
    if (data)
      return data;
    data = generateSectorData(this.seed, sx, sy, sz);
    this.map.set(key, data);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined)
        this.map.delete(oldest);
    }
    return data;
  }

  /** The cached sector, or undefined without generating it (for budgeted callers). */
  peek(sx: number, sy: number, sz: number): SectorData | undefined {
    return this.touch(`${sx},${sy},${sz}`);
  }

  // A hit moves the sector to the back of the Map's insertion order, which is
  // the eviction order.
  private touch(key: string): SectorData | undefined {
    const data = this.map.get(key);
    if (data) {
      this.map.delete(key);
      this.map.set(key, data);
    }
    return data;
  }
}
