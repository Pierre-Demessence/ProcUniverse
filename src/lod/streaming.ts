import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { SectorCache } from './sector-cache';
import type { SectorRange } from './tier';

import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { spawnSector } from '../generation/spawn';
import { OrbitElementsDef } from '../sim/orbits';

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
 *
 * Positions and orbit centres are relative to the floating render origin. When
 * the origin moves, `update` shifts the live bodies onto it instead of
 * respawning them, so their entity ids — and with them the selection, the
 * camera lock and the meshes built for them — survive the move.
 */
export class SystemStreamer {
  private readonly active = new Map<string, EntityId[]>();
  private readonly cache: SectorCache;
  // The render origin the live bodies' positions and orbit centres are relative to.
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private planetCount = 0;
  private starCount = 0;
  private readonly starsPerSector = new Map<string, number>();
  private readonly world: EcsWorld;

  constructor(world: EcsWorld, cache: SectorCache) {
    this.world = world;
    this.cache = cache;
  }

  /** Despawn every streamed sector (e.g. when leaving the SYSTEM tier). */
  clear(): void {
    if (this.active.size === 0)
      return;
    for (const ids of this.active.values()) {
      for (const id of ids)
        this.world.queueDestroy(id);
    }
    this.active.clear();
    this.starsPerSector.clear();
    this.starCount = 0;
    this.planetCount = 0;
  }

  /**
   * Re-express every live body against a new render origin: positions and
   * orbit centres move by `old − new`, mutated in place like `updateOrbits`
   * (no lifecycle events). Local values stay within a few sectors, so the
   * rounding of each shift is far below a metre; a star spawned against the old
   * origin that becomes the new one lands exactly on 0 (`(p − a) + (a − p)` is
   * exact in floating point).
   */
  private moveOrigin(originX: number, originY: number, originZ: number): void {
    const dx = this.originX - originX;
    const dy = this.originY - originY;
    const dz = this.originZ - originZ;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    if ((dx === 0 && dy === 0 && dz === 0) || this.active.size === 0)
      return;
    const positions = this.world.getStore(Position3DDef);
    const orbits = this.world.getStore(OrbitElementsDef);
    for (const ids of this.active.values()) {
      for (const id of ids) {
        const pos = positions.get(id);
        if (pos) {
          pos.x += dx;
          pos.y += dy;
          pos.z += dz;
        }
        const orbit = orbits.get(id);
        if (orbit) {
          orbit.cx += dx;
          orbit.cy += dy;
          orbit.cz += dz;
        }
      }
    }
  }

  status(): StreamStatus {
    return { planets: this.planetCount, sectors: this.active.size, stars: this.starCount };
  }

  /**
   * Reconcile the spawned sectors with the visible range relative to the
   * floating render origin `(originX, originY, originZ)`: live bodies are
   * shifted onto it if it moved, then sectors that left the range despawn and
   * new ones spawn against it.
   */
  update(range: SectorRange, originX: number, originY: number, originZ: number): void {
    this.moveOrigin(originX, originY, originZ);

    // Despawn sectors that left the range (deleting during Map iteration is safe).
    for (const [key, ids] of this.active) {
      const [sx, sy, sz] = key.split(',').map(Number);
      if (sx < range.minSx || sx > range.maxSx || sy < range.minSy || sy > range.maxSy || sz < range.minSz || sz > range.maxSz) {
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
    for (let sz = range.minSz; sz <= range.maxSz; sz++) {
      for (let sy = range.minSy; sy <= range.maxSy; sy++) {
        for (let sx = range.minSx; sx <= range.maxSx; sx++) {
          const key = `${sx},${sy},${sz}`;
          if (this.active.has(key))
            continue;
          const data = this.cache.get(sx, sy, sz);
          const ids = spawnSector(this.world, data, star => this.cache.system(star), originX, originY, originZ);
          this.active.set(key, ids);
          this.starsPerSector.set(key, data.stars.length);
          this.starCount += data.stars.length;
          this.planetCount += ids.length - data.stars.length;
        }
      }
    }
  }
}
