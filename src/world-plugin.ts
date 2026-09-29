import type { Plugin } from '@pierre/ecs';

import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { BodyVisualDef } from './generation/body-visual';
import { BlackHoleDef } from './generation/galaxies';
import { MoonPhysicalDef } from './generation/moons';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';
import { OrbitElementsDef } from './sim/orbits';

/** Registers every component the streamed universe bodies carry. */
export const universePlugin: Plugin = {
  name: 'universe',
  build(world) {
    world.registerComponent(Position3DDef);
    world.registerComponent(BodyVisualDef);
    world.registerComponent(OrbitElementsDef);
    world.registerComponent(StarPhysicalDef);
    world.registerComponent(PlanetPhysicalDef);
    world.registerComponent(MoonPhysicalDef);
    world.registerComponent(NameDef);
    world.registerComponent(BlackHoleDef);
  },
};
