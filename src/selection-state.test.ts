import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { OrbitElements } from './sim/orbits';

import { EcsWorld } from '@pierre/ecs';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { lockedBodyLocalPos } from './camera/framing';
import { galaxyAt } from './generation/galaxies';
import { NameDef } from './generation/naming';
import { SelectionState } from './selection-state';
import { OrbitElementsDef } from './sim/orbits';

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

function makeWorld(): EcsWorld {
  const world = new EcsWorld();
  world.registerComponent(Position3DDef);
  world.registerComponent(OrbitElementsDef);
  world.registerComponent(NameDef);
  return world;
}

function addBody(world: EcsWorld, scientific: string, orbiting = true): EntityId {
  const id = world.createEntity();
  world.getStore(Position3DDef).set(id, { x: 1, y: 2, z: 0 });
  world.getStore(NameDef).set(id, { human: scientific, scientific });
  if (orbiting)
    world.getStore(OrbitElementsDef).set(id, ORBIT);
  return id;
}

function bookmark(kind: Bookmark['kind'], name: string, x = 0, y = 0): Bookmark {
  return { name, extentAu: 1, kind, label: name, x, y };
}

describe('selectionState', () => {
  it('select clears the lock and any pending bookmark', () => {
    const world = makeWorld();
    const s = new SelectionState();
    s.openBookmark(bookmark('planet', 'LATER'), world, 1);
    const id = addBody(world, 'P');
    s.select({ id, kind: 'planet' });
    s.toggleLock();
    expect(s.lockedId).toBe(id);
    s.select(null);
    expect(s.lockedId).toBeNull();
    addBody(world, 'LATER');
    expect(s.resolvePending(world)).toBeNull();
  });

  it('keeps the current selection while a bookmark is pending', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'S', false);
    s.select({ id, kind: 'star' });
    s.openBookmark(bookmark('planet', 'LATER'), world, 1);
    expect(s.selection).toEqual({ id, kind: 'star' });
  });

  it('locks planets and moons but not stars', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const star = addBody(world, 'S', false);
    s.select({ id: star, kind: 'star' });
    s.toggleLock();
    expect(s.lockedId).toBeNull();
    const planet = addBody(world, 'P');
    s.select({ id: planet, kind: 'planet' });
    s.toggleLock();
    expect(s.lockedId).toBe(planet);
    s.toggleLock();
    expect(s.lockedId).toBeNull();
  });

  it('opens a streamed planet bookmark: selects, locks, returns its id', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'P');
    expect(s.openBookmark(bookmark('planet', 'P'), world, 1)).toBe(id);
    expect(s.selection).toEqual({ id, kind: 'planet' });
    expect(s.lockedId).toBe(id);
  });

  it('opens a streamed star bookmark without locking', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'S', false);
    s.openBookmark(bookmark('star', 'S'), world, 1);
    expect(s.selection).toEqual({ id, kind: 'star' });
    expect(s.lockedId).toBeNull();
  });

  it('keeps an unstreamed bookmark pending until the body appears', () => {
    const world = makeWorld();
    const s = new SelectionState();
    expect(s.openBookmark(bookmark('moon', 'M'), world, 1)).toBeNull();
    expect(s.resolvePending(world)).toBeNull();
    const id = addBody(world, 'M');
    expect(s.resolvePending(world)).toBe(id);
    expect(s.selection).toEqual({ id, kind: 'moon' });
    expect(s.lockedId).toBe(id);
    expect(s.resolvePending(world)).toBeNull();
  });

  it('opens the universe bookmark', () => {
    const s = new SelectionState();
    expect(s.openBookmark(bookmark('universe', ''), makeWorld(), 42)).toBeNull();
    expect(s.selection).toEqual({ kind: 'universe', seed: 42 });
  });

  it('opens a galaxy bookmark at the galaxy under its position', () => {
    let seed = 1;
    while (seed < 1000 && !galaxyAt(seed, 0, 0))
      seed++;
    const g = galaxyAt(seed, 0, 0);
    if (!g)
      throw new Error('no seed with a galaxy at the origin');
    const s = new SelectionState();
    s.openBookmark(bookmark('galaxy', g.name, 0, 0), makeWorld(), seed);
    expect(s.selection).toEqual({ galaxy: g, kind: 'galaxy' });
  });

  it('reports the locked body position and unlocks when it streams out', () => {
    const world = makeWorld();
    const s = new SelectionState();
    const id = addBody(world, 'P');
    s.select({ id, kind: 'planet' });
    s.lockSelectedOrbiter();
    expect(s.lockedPosition(world, 1000)).toEqual(lockedBodyLocalPos(world, id, 1000));
    world.getStore(OrbitElementsDef).delete(id);
    expect(s.lockedPosition(world, 1000)).toBeNull();
    expect(s.lockedId).toBeNull();
  });
});
