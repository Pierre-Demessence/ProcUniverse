import { EcsWorld } from '@pierre/ecs';
import { makeCamera, worldToView } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { NameDef } from './generation/naming';
import { findEntityByName, pickGalaxyAt } from './pick';

describe('pickGalaxyAt', () => {
  it('selects the home galaxy at the world origin', () => {
    const fieldCam = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 1e-5 });
    const { vx, vy } = worldToView(0, 0, fieldCam);
    const galaxy = pickGalaxyAt(1337, fieldCam, 0, 0, vx, vy);
    expect(galaxy?.centerX).toBe(0);
    expect(galaxy?.centerY).toBe(0);
  });
});

describe('findEntityByName', () => {
  it('returns the entity carrying the given catalogue name', () => {
    const world = new EcsWorld();
    world.registerComponent(NameDef);
    const a = world.createEntity();
    world.getStore(NameDef).set(a, { human: 'Talos', scientific: 'G-4F2A9' });
    const b = world.createEntity();
    world.getStore(NameDef).set(b, { human: 'Talos b', scientific: 'G-4F2A9 b' });
    expect(findEntityByName(world, 'G-4F2A9')).toBe(a);
    expect(findEntityByName(world, 'G-4F2A9 b')).toBe(b);
  });

  it('returns null when no entity carries the name', () => {
    const world = new EcsWorld();
    world.registerComponent(NameDef);
    expect(findEntityByName(world, 'absent')).toBeNull();
  });
});
