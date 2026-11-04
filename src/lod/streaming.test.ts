import type { SectorRange } from './tier';

import { EcsWorld } from '@pierre/ecs';
import { describe, expect, it } from 'vitest';

import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { universePlugin } from '../world-plugin';
import { SectorCache } from './sector-cache';
import { SystemStreamer } from './streaming';

const SEED = 1337;
const sector = (sx: number, sy: number, sz: number): SectorRange => ({ maxSx: sx, maxSy: sy, maxSz: sz, minSx: sx, minSy: sy, minSz: sz });

function setup(): { cache: SectorCache; streamer: SystemStreamer; world: EcsWorld } {
  const world = new EcsWorld().use(universePlugin);
  const cache = new SectorCache(SEED);
  return { cache, streamer: new SystemStreamer(world, cache), world };
}

const count = (world: EcsWorld, def: typeof StarPhysicalDef | typeof PlanetPhysicalDef): number => [...world.query(def)].length;

describe('systemStreamer', () => {
  it('spawns each star of a sector with its generated planets', () => {
    const { cache, streamer, world } = setup();
    const stars = cache.get(0, 0, 0).stars;
    expect(stars.length).toBeGreaterThan(0);
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    world.endOfTick();
    const systems = stars.map(star => cache.system(star));
    const planets = systems.reduce((n, system) => n + system.planets.length, 0);
    const moons = systems.reduce((n, system) => n + system.planets.reduce((m, planet) => m + planet.moons.length, 0), 0);
    expect(count(world, StarPhysicalDef)).toBe(stars.length);
    expect(count(world, PlanetPhysicalDef)).toBe(planets);
    // The status counts every non-star entity: moons and black holes included.
    const others = planets + moons + cache.get(0, 0, 0).blackHoles.length;
    expect(streamer.status()).toEqual({ planets: others, sectors: 1, stars: stars.length });
  });

  it('keeps a sector spawned across updates and despawns it when it leaves the range', () => {
    const { streamer, world } = setup();
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    world.endOfTick();
    const before = count(world, StarPhysicalDef);
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    world.endOfTick();
    expect(count(world, StarPhysicalDef)).toBe(before);

    // A range above the first one in z only: the sector leaves, the new one enters.
    streamer.update(sector(0, 0, 1), 0, 0, 0);
    world.endOfTick();
    expect(streamer.status().sectors).toBe(1);
    const stars = new SectorCache(SEED).get(0, 0, 1).stars.length;
    expect(count(world, StarPhysicalDef)).toBe(stars);
  });

  it('streams every sector of a 3D range, along z too', () => {
    const { streamer } = setup();
    streamer.update({ maxSx: 1, maxSy: 0, maxSz: 1, minSx: 0, minSy: 0, minSz: 0 }, 0, 0, 0);
    expect(streamer.status().sectors).toBe(4);
  });

  it('clear despawns everything and resets the counts', () => {
    const { streamer, world } = setup();
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    streamer.clear();
    world.endOfTick();
    expect(count(world, StarPhysicalDef)).toBe(0);
    expect(count(world, PlanetPhysicalDef)).toBe(0);
    expect(streamer.status()).toEqual({ planets: 0, sectors: 0, stars: 0 });
  });
});
