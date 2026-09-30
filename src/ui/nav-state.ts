/** Location-tree state derived from the camera, tier, and selection. */

import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { SystemData } from '../generation/universe';
import type { Tier } from '../lod/tier';
import type { Selection } from '../pick';
import type { NavState, NavSystem } from './nav-tree';

import { galaxyAt } from '../generation/galaxies';
import { NameDef } from '../generation/naming';

/** The tree-node `key` matching the current selection, for highlighting. */
export function selectionKey(world: EcsWorld, selection: Selection | null): string | null {
  if (!selection)
    return null;
  if (selection.kind === 'universe')
    return 'universe';
  if (selection.kind === 'galaxy')
    return `galaxy:${selection.galaxy.name}`;
  return world.getStore(NameDef).get(selection.id)?.scientific ?? null;
}

/**
 * Assemble the location tree's state; `camera` is in absolute AU and `focus` is
 * the frame's focused system (the one the render origin is anchored to).
 */
export function buildNavState(seed: number, focus: SystemData | null, camera: Camera, tier: Tier, world: EcsWorld, selection: Selection | null): NavState {
  const galaxy = galaxyAt(seed, camera.x, camera.y);
  let system: NavSystem | null = null;
  if (tier === 'system') {
    if (focus) {
      system = {
        name: focus.name.scientific,
        humanName: focus.name.human,
        planets: focus.planets.map(p => ({
          name: p.name.scientific,
          humanName: p.name.human,
          moons: p.moons.map(m => ({ name: m.name.scientific, humanName: m.name.human })),
        })),
      };
    }
  }
  return {
    galaxy: galaxy ? { name: galaxy.name, humanName: galaxy.humanName } : null,
    selectedKey: selectionKey(world, selection),
    system,
    tier,
  };
}
