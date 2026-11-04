import type { ScreenProjector } from './render/draw-labels';

import { EcsWorld } from '@pierre/ecs';
import { makeCamera, worldToView } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { NameDef } from './generation/naming';
import { findEntityByName, pickGalaxyAt } from './pick';

describe('pickGalaxyAt', () => {
  const fieldCam = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 1e-5 });
  // A straight-down view: the screen position is the camera's flat mapping, and a
  // unit of world length spans `zoom` pixels at every depth.
  const topDown: ScreenProjector = (x, y, _z, out) => {
    const { vx, vy } = worldToView(x, y, fieldCam);
    out.sx = vx;
    out.sy = vy;
    out.pxPerAu = fieldCam.zoom;
    return true;
  };

  it('selects the home galaxy at the world origin', () => {
    const { vx, vy } = worldToView(0, 0, fieldCam);
    const galaxy = pickGalaxyAt(1337, fieldCam, 0, 0, 0, 0, vx, vy, topDown);
    expect(galaxy?.centerX).toBe(0);
    expect(galaxy?.centerY).toBe(0);
  });

  it('picks by the projected position, so a view that shifts everything on screen moves the hit with it', () => {
    const shifted: ScreenProjector = (x, y, z, out) => {
      const ok = topDown(x, y, z, out);
      out.sx += 100000;
      return ok;
    };
    const { vx, vy } = worldToView(0, 0, fieldCam);
    expect(pickGalaxyAt(1337, fieldCam, 0, 0, 0, 0, vx, vy, shifted)).toBeNull();
    expect(pickGalaxyAt(1337, fieldCam, 0, 0, 0, 0, vx + 100000, vy, shifted)?.centerX).toBe(0);
  });

  it('ignores galaxies the projector reports as hidden', () => {
    const { vx, vy } = worldToView(0, 0, fieldCam);
    expect(pickGalaxyAt(1337, fieldCam, 0, 0, 0, 0, vx, vy, () => false)).toBeNull();
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
