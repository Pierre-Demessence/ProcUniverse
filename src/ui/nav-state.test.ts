import type { EntityId } from '@pierre/ecs/entity-id';

import type { GalaxyParams } from '../generation/galaxies';
import type { SectorData, SystemData } from '../generation/universe';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { NameDef } from '../generation/naming';
import { nearestSystem } from '../lod/nearest-system';
import { SECTOR_SIZE } from '../scale';
import { buildNavState, selectionKey } from './nav-state';

function system(x: number, y: number, name: string, z = 0): SystemData {
  return {
    name: { human: `Human ${name}`, scientific: name },
    planets: [{ name: { human: 'Planet', scientific: `${name} b` }, moons: [{ name: { human: 'Moon', scientific: `${name} b I` } }] }],
    x,
    y,
    z,
  } as unknown as SystemData;
}

type NearestCache = Parameters<typeof nearestSystem>[0];

/** A cache whose sector (0, 0, 0) holds `systems`, every other sector is empty; `system` returns the record as is. */
function cacheOf(systems: SystemData[]): NearestCache {
  return {
    get: (sx: number, sy: number, sz: number) => ({ stars: sx === 0 && sy === 0 && sz === 0 ? systems : [] }) as unknown as SectorData,
    system: star => star as SystemData,
  };
}

function worldWithName(scientific: string): { id: EntityId; world: EcsWorld } {
  const world = new EcsWorld();
  world.registerComponent(NameDef);
  const id = world.createEntity();
  world.getStore(NameDef).set(id, { human: 'H', scientific });
  return { id, world };
}

describe('nearestSystem', () => {
  it('returns the closest system in the camera sector', () => {
    const near = system(10, 10, 'NEAR');
    const cache = cacheOf([system(900, 900, 'FAR'), near]);
    expect(nearestSystem(cache, 12, 11, 0)).toBe(near);
  });

  it('weighs height: a star far above the focus loses to a level one farther away in x, y', () => {
    const above = system(10, 10, 'ABOVE', 5000);
    const level = system(400, 10, 'LEVEL', 0);
    expect(nearestSystem(cacheOf([above, level]), 10, 10, 0)).toBe(level);
    expect(nearestSystem(cacheOf([above, level]), 10, 10, 4900)).toBe(above);
  });

  it('returns null for an empty sector', () => {
    expect(nearestSystem(cacheOf([]), 0, 0, 0)).toBeNull();
  });

  it('searches the 3×3×3 sectors around the one containing the camera', () => {
    const seen: [number, number, number][] = [];
    const cache: NearestCache = {
      system: star => star as SystemData,
      get: (sx, sy, sz) => {
        seen.push([sx, sy, sz]);
        return { stars: [] } as unknown as SectorData;
      },
    };
    nearestSystem(cache, SECTOR_SIZE * 2.5, -SECTOR_SIZE * 0.5, SECTOR_SIZE * 1.5);
    expect(seen).toHaveLength(27);
    expect(seen).toContainEqual([2, -1, 1]);
    expect(seen).toContainEqual([1, -2, 0]);
    expect(seen).toContainEqual([3, 0, 2]);
  });

  it('finds a nearer star just across a sector face', () => {
    // The camera sits in sector (1, 0, 0), 10 AU from the face it shares with
    // sector (0, 0, 0); the star there is nearer than the one in the camera's own sector.
    const across = system(SECTOR_SIZE - 5, 10, 'ACROSS');
    const own = system(SECTOR_SIZE + SECTOR_SIZE / 2, 10, 'OWN');
    const cache: NearestCache = {
      get: (sx, sy, sz) => ({ stars: sx === 0 && sy === 0 && sz === 0 ? [across] : sx === 1 && sy === 0 && sz === 0 ? [own] : [] }) as unknown as SectorData,
      system: star => star as SystemData,
    };
    expect(nearestSystem(cache, SECTOR_SIZE + 10, 10, 0)).toBe(across);
  });

  it('returns the full system the cache builds for the nearest star record', () => {
    const record = system(10, 10, 'RECORD');
    const full = system(10, 10, 'FULL');
    const cache: NearestCache = { get: () => ({ stars: [record] }) as unknown as SectorData, system: () => full };
    expect(nearestSystem(cache, 10, 10, 0)).toBe(full);
  });
});

describe('selectionKey', () => {
  it('keys the universe, a galaxy, and a named body', () => {
    const { id, world } = worldWithName('G2-ABC');
    const galaxy = { name: 'NGC 1' } as unknown as GalaxyParams;
    expect(selectionKey(world, null)).toBeNull();
    expect(selectionKey(world, { kind: 'universe', seed: 1 })).toBe('universe');
    expect(selectionKey(world, { galaxy, kind: 'galaxy' })).toBe('galaxy:NGC 1');
    expect(selectionKey(world, { id, kind: 'star' })).toBe('G2-ABC');
  });

  it('is null for a body that streamed out', () => {
    const { world } = worldWithName('X');
    expect(selectionKey(world, { id: 999 as EntityId, kind: 'planet' })).toBeNull();
  });
});

describe('buildNavState', () => {
  const camera = makeCamera({ viewportH: 600, viewportW: 800, x: 10, y: 10, zoom: 1 });

  it('lists the focused system with planets and moons at the system tier', () => {
    const { world } = worldWithName('X');
    const nav = buildNavState(1, system(10, 10, 'SYS'), camera, 0, 'system', world, null);
    expect(nav.tier).toBe('system');
    expect(nav.system).toEqual({
      name: 'SYS',
      humanName: 'Human SYS',
      planets: [{ name: 'SYS b', humanName: 'Planet', moons: [{ name: 'SYS b I', humanName: 'Moon' }] }],
    });
  });

  it('omits the system above the system tier and carries the selection key', () => {
    const { id, world } = worldWithName('SYS');
    const nav = buildNavState(1, system(10, 10, 'SYS'), camera, 0, 'star', world, { id, kind: 'star' });
    expect(nav.system).toBeNull();
    expect(nav.selectedKey).toBe('SYS');
  });
});
