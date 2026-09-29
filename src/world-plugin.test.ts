import { EcsWorld } from '@pierre/ecs';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it } from 'vitest';

import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef, PositionZDef } from './sim/orbits';
import { universePlugin } from './world-plugin';

describe('universePlugin', () => {
  it('registers every component a streamed body carries', () => {
    const world = new EcsWorld().use(universePlugin);
    const defs = [PositionDef, RenderableDef, OrbitElementsDef, PositionZDef, StarPhysicalDef, PlanetPhysicalDef, MoonPhysicalDef, NameDef, BlackHoleDef];
    for (const def of defs)
      expect(world.getStoreByName(def.name), def.name).toBeDefined();
    expect(world.hasPlugin('universe')).toBe(true);
  });
});
