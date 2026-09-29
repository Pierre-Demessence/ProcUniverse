import { EcsWorld } from '@pierre/ecs';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { BodyVisualDef } from './generation/body-visual';
import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef } from './sim/orbits';
import { universePlugin } from './world-plugin';

describe('universePlugin', () => {
  it('registers every component a streamed body carries', () => {
    const world = new EcsWorld().use(universePlugin);
    const defs = [Position3DDef, BodyVisualDef, OrbitElementsDef, StarPhysicalDef, PlanetPhysicalDef, MoonPhysicalDef, NameDef, BlackHoleDef];
    for (const def of defs)
      expect(world.getStoreByName(def.name), def.name).toBeDefined();
    expect(world.hasPlugin('universe')).toBe(true);
  });
});
