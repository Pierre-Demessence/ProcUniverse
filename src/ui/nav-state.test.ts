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

function system(x: number, y: number, name: string): SystemData {
  return {
    name: { human: `Human ${name}`, scientific: name },
    planets: [{ name: { human: 'Planet', scientific: `${name} b` }, moons: [{ name: { human: 'Moon', scientific: `${name} b I` } }] }],
    x,
    y,
  } as unknown as SystemData;
}

function cacheOf(systems: SystemData[]): { get: (sx: number, sy: number) => SectorData } {
  return { get: () => ({ systems }) as unknown as SectorData };
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
    expect(nearestSystem(cache, 12, 11)).toBe(near);
  });

  it('returns null for an empty sector', () => {
    expect(nearestSystem(cacheOf([]), 0, 0)).toBeNull();
  });

  it('looks up the sector containing the camera', () => {
    const seen: [number, number][] = [];
    const cache = { get: (sx: number, sy: number): SectorData => {
      seen.push([sx, sy]);
      return { systems: [] } as unknown as SectorData;
    } };
    nearestSystem(cache, SECTOR_SIZE * 2.5, -SECTOR_SIZE * 0.5);
    expect(seen).toEqual([[2, -1]]);
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
    const nav = buildNavState(1, cacheOf([system(10, 10, 'SYS')]), camera, 'system', world, null);
    expect(nav.tier).toBe('system');
    expect(nav.system).toEqual({
      name: 'SYS',
      humanName: 'Human SYS',
      planets: [{ name: 'SYS b', humanName: 'Planet', moons: [{ name: 'SYS b I', humanName: 'Moon' }] }],
    });
  });

  it('omits the system above the system tier and carries the selection key', () => {
    const { id, world } = worldWithName('SYS');
    const nav = buildNavState(1, cacheOf([system(10, 10, 'SYS')]), camera, 'star', world, { id, kind: 'star' });
    expect(nav.system).toBeNull();
    expect(nav.selectedKey).toBe('SYS');
  });
});
