import type { SectorRange } from './tier';

import { EcsWorld } from '@pierre/ecs';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { OrbitElementsDef } from '../sim/orbits';
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

  it('keeps its bodies across an origin move, shifting positions and orbit centres onto the new origin', () => {
    const { cache, streamer, world } = setup();
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    world.endOfTick();
    const positions = world.getStore(Position3DDef);
    const orbits = world.getStore(OrbitElementsDef);
    const before = new Map([...world.query(Position3DDef)].map(([id, p]) => [id, { ...p }]));
    const orbitsBefore = new Map([...world.query(OrbitElementsDef)].map(([id, o]) => [id, { ...o }]));
    expect(before.size).toBeGreaterThan(0);

    // Move the origin onto a star of the sector, as the rebase does when that system is focused.
    const star = cache.get(0, 0, 0).stars[0];
    streamer.update(sector(0, 0, 0), star.x, star.y, star.z);
    world.endOfTick();

    // Same entities (ids survive, so selections and locks do), each moved by −origin.
    expect(new Set([...world.query(Position3DDef)].map(([id]) => id))).toEqual(new Set(before.keys()));
    for (const [id, p] of before) {
      const now = positions.get(id)!;
      expect(now.x).toBeCloseTo(p.x - star.x, 6);
      expect(now.y).toBeCloseTo(p.y - star.y, 6);
      expect(now.z).toBeCloseTo(p.z - star.z, 6);
    }
    for (const [id, o] of orbitsBefore) {
      const now = orbits.get(id)!;
      expect(now.cx).toBeCloseTo(o.cx - star.x, 6);
      expect(now.cy).toBeCloseTo(o.cy - star.y, 6);
      expect(now.cz).toBeCloseTo(o.cz - star.z, 6);
    }
    // The star that became the origin sits exactly on it.
    const starId = [...world.query(Position3DDef)].find(([, p]) => p.x === 0 && p.y === 0 && p.z === 0)?.[0];
    expect(starId).toBeDefined();
    expect(world.getStore(StarPhysicalDef).get(starId!)).toEqual(star.star);
  });

  it('spawns entering sectors against the moved origin', () => {
    const { cache, streamer, world } = setup();
    streamer.update(sector(0, 0, 0), 0, 0, 0);
    const star = cache.get(0, 0, 1).stars[0];
    streamer.update(sector(0, 0, 1), 10, 20, 30);
    world.endOfTick();
    const positions = [...world.query(Position3DDef)].map(([, p]) => p);
    expect(positions).toContainEqual({ x: star.x - 10, y: star.y - 20, z: star.z - 30 });
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
