import type { SectorData } from '../generation/universe';

import { generateSectorData } from '../generation/universe';

/**
 * Generate-on-demand cache of deterministic `SectorData`, keyed by sector
 * coordinates. Because generation is a pure function of `(seed, sx, sy)`, a
 * cache miss is cheap to fill and an evicted sector regenerates identically.
 * FIFO eviction keeps memory bounded; the capacity comfortably exceeds the
 * worst-case visible-sector count at the star tier.
 */
export class SectorCache {
  private readonly capacity: number;
  private readonly map = new Map<string, SectorData>();
  private readonly seed: number;

  constructor(seed: number, capacity = 2048) {
    this.seed = seed;
    this.capacity = capacity;
  }

  get(sx: number, sy: number): SectorData {
    const key = `${sx},${sy}`;
    let data = this.map.get(key);
    if (data)
      return data;
    data = generateSectorData(this.seed, sx, sy);
    this.map.set(key, data);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined)
        this.map.delete(oldest);
    }
    return data;
  }
}
