import type { Plugin } from '@pierre/ecs';

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef, PositionZDef } from './sim/orbits';

/** Registers every component the streamed universe bodies carry. */
export const universePlugin: Plugin = {
  name: 'universe',
  build(world) {
    world.registerComponent(PositionDef);
    world.registerComponent(RenderableDef);
    world.registerComponent(OrbitElementsDef);
    world.registerComponent(PositionZDef);
    world.registerComponent(StarPhysicalDef);
    world.registerComponent(PlanetPhysicalDef);
    world.registerComponent(MoonPhysicalDef);
    world.registerComponent(NameDef);
    world.registerComponent(BlackHoleDef);
  },
};
