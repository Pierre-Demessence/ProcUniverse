import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { GalaxyParams } from './generation/galaxies';
import type { PlanetPhysical } from './generation/planets';
import type { OrbitElements } from './sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { bookmarkFromSelection, bookmarkZ, removeBookmark, toggleBookmark } from './bookmarks';
import { selectionFrame } from './camera/framing';
import { GALAXY_SPRITE_SCALE } from './config/render';
import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef } from './sim/orbits';

const PLANET: PlanetPhysical = {
  density: 5.5,
  equilibriumTemp: 280,
  hasRings: false,
  inHabitableZone: true,
  insolation: 1,
  mass: 1,
  moonRichness: 0.5,
  obliquity: 23,
  obliquityAzimuth: 0,
  radius: 1,
  rotationPeriod: 24,
  tidallyLocked: false,
  type: 'rocky',
  waterState: 'liquid',
};

const ORBIT: OrbitElements = {
  a: 1,
  argPeriapsis: 0,
  cx: 0,
  cy: 0,
  cz: 0,
  e: 0,
  inclination: 0,
  longitudeAscendingNode: 0,
  meanAnomaly0: 0,
  parent: -1,
  starMass: 1,
};

function worldWithPlanet(x: number, y: number): { id: EntityId; world: EcsWorld } {
  const world = new EcsWorld();
  world.registerComponent(Position3DDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(NameDef);
  world.registerComponent(StarPhysicalDef);
  world.registerComponent(PlanetPhysicalDef);
  world.registerComponent(MoonPhysicalDef);
  world.registerComponent(BlackHoleDef);
  const id = world.createEntity();
  world.getStore(Position3DDef).set(id, { x, y, z: 0 });
  world.getStore(PlanetPhysicalDef).set(id, PLANET);
  world.getStore(OrbitElementsDef).set(id, ORBIT);
  world.getStore(NameDef).set(id, { human: 'Aurelia', scientific: 'G2-ABC b' });
  return { id, world };
}

describe('bookmarkFromSelection', () => {
  it('captures a planet at its absolute position with its frame extent', () => {
    const { id, world } = worldWithPlanet(3, 4);
    const bm = bookmarkFromSelection({ id, kind: 'planet' }, world, 1000, 2000, 300);
    expect(bm).toEqual({
      name: 'G2-ABC b',
      extentAu: selectionFrame({ id, kind: 'planet' }, world, 1000, 2000)?.extentAu,
      kind: 'planet',
      label: 'Aurelia',
      x: 1003,
      y: 2004,
      z: 300,
    });
  });

  it('captures a galaxy at its centre', () => {
    const { world } = worldWithPlanet(0, 0);
    const galaxy = { name: 'NGC 1', centerX: 5, centerY: 6, humanName: 'Andromeda', radius: 10 } as unknown as GalaxyParams;
    expect(bookmarkFromSelection({ galaxy, kind: 'galaxy' }, world, 0, 0)).toEqual({
      name: 'NGC 1',
      extentAu: 10 * GALAXY_SPRITE_SCALE,
      kind: 'galaxy',
      label: 'Andromeda',
      x: 5,
      y: 6,
      z: 0,
    });
  });

  it('captures the universe and rejects streamed-out bodies', () => {
    const { world } = worldWithPlanet(0, 0);
    expect(bookmarkFromSelection({ kind: 'universe', seed: 1 }, world, 0, 0)?.kind).toBe('universe');
    expect(bookmarkFromSelection({ id: 999 as EntityId, kind: 'planet' }, world, 0, 0)).toBeNull();
  });
});

describe('toggleBookmark / removeBookmark', () => {
  it('adds a bookmark, then removes it on the second toggle', () => {
    const { id, world } = worldWithPlanet(0, 0);
    const list: Bookmark[] = [];
    expect(toggleBookmark(list, { id, kind: 'planet' }, world, 0, 0)).toBe(true);
    expect(list.map(b => b.name)).toEqual(['G2-ABC b']);
    expect(toggleBookmark(list, { id, kind: 'planet' }, world, 0, 0)).toBe(true);
    expect(list).toEqual([]);
  });

  it('does nothing for a streamed-out body', () => {
    const { world } = worldWithPlanet(0, 0);
    const list: Bookmark[] = [];
    expect(toggleBookmark(list, { id: 999 as EntityId, kind: 'planet' }, world, 0, 0)).toBe(false);
    expect(list).toEqual([]);
  });

  it('removes by kind and name, not by reference', () => {
    const list: Bookmark[] = [{ name: 'A', extentAu: 1, kind: 'star', label: 'A', x: 0, y: 0 }];
    expect(removeBookmark(list, { name: 'A', extentAu: 9, kind: 'star', label: 'other', x: 5, y: 5 })).toBe(true);
    expect(list).toEqual([]);
    expect(removeBookmark(list, { name: 'A', extentAu: 1, kind: 'star', label: 'A', x: 0, y: 0 })).toBe(false);
  });
});

describe('bookmarkZ', () => {
  const cache = { get: () => ({ systems: [{ x: 10, y: 10, z: 777 }, { x: 5000, y: 10, z: -50 }] }) } as never;
  const bm = (kind: Bookmark['kind'], z?: number): Bookmark => ({ name: 'N', extentAu: 1, kind, label: 'N', x: 12, y: 11, ...(z === undefined ? {} : { z }) });

  it('uses the stored height when the bookmark has one', () => {
    expect(bookmarkZ(bm('planet', 42), cache)).toBe(42);
  });

  it('recomputes an old body bookmark height from its nearest system', () => {
    expect(bookmarkZ(bm('planet'), cache)).toBe(777);
    expect(bookmarkZ(bm('star'), cache)).toBe(777);
  });

  it('puts galaxies, black holes and the universe on the galactic plane', () => {
    expect(bookmarkZ(bm('galaxy'), cache)).toBe(0);
    expect(bookmarkZ(bm('black-hole'), cache)).toBe(0);
    expect(bookmarkZ(bm('universe'), cache)).toBe(0);
  });
});
