import type { EntityId } from '@pierre/ecs/entity-id';
import type { EcsWorld } from '@pierre/ecs';

import type { SectorCache } from './sector-cache';
import type { SectorRange } from './tier';

import { spawnSector } from '../generation/spawn';

export interface StreamStatus {
  planets: number;
  sectors: number;
  stars: number;
}

/**
 * Streams full systems (star + planets + orbits) as ECS entities for the
 * sectors overlapping the view at the SYSTEM tier. Sectors are spawned when
 * they enter the visible range and despawned when they leave, so the live
 * entity count tracks what is on screen rather than the whole universe.
 */
export class SystemStreamer {
  private readonly active = new Map<string, EntityId[]>();
  private readonly starsPerSector = new Map<string, number>();
  private readonly world: EcsWorld;
  private readonly cache: SectorCache;
  private planetCount = 0;
  private starCount = 0;

  constructor(world: EcsWorld, cache: SectorCache) {
    this.world = world;
    this.cache = cache;
  }

  /** Despawn every streamed sector (e.g. when leaving the SYSTEM tier). */
  clear(): void {
    if (this.active.size === 0)
      return;
    for (const ids of this.active.values())
      for (const id of ids)
        this.world.queueDestroy(id);
    this.active.clear();
    this.starsPerSector.clear();
    this.starCount = 0;
    this.planetCount = 0;
  }

  status(): StreamStatus {
    return { planets: this.planetCount, sectors: this.active.size, stars: this.starCount };
  }

  /** Reconcile the spawned sectors with the visible range. */
  update(range: SectorRange): void {
    // Despawn sectors that left the range (deleting during Map iteration is safe).
    for (const [key, ids] of this.active) {
      const comma = key.indexOf(',');
      const sx = Number(key.slice(0, comma));
      const sy = Number(key.slice(comma + 1));
      if (sx < range.minSx || sx > range.maxSx || sy < range.minSy || sy > range.maxSy) {
        for (const id of ids)
          this.world.queueDestroy(id);
        const stars = this.starsPerSector.get(key) ?? 0;
        this.starCount -= stars;
        this.planetCount -= ids.length - stars;
        this.active.delete(key);
        this.starsPerSector.delete(key);
      }
    }

    // Spawn sectors that entered the range.
    for (let sy = range.minSy; sy <= range.maxSy; sy++) {
      for (let sx = range.minSx; sx <= range.maxSx; sx++) {
        const key = `${sx},${sy}`;
        if (this.active.has(key))
          continue;
        const data = this.cache.get(sx, sy);
        const ids = spawnSector(this.world, data);
        this.active.set(key, ids);
        this.starsPerSector.set(key, data.systems.length);
        this.starCount += data.systems.length;
        this.planetCount += ids.length - data.systems.length;
      }
    }
  }
}
