import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { GalaxyParams } from './generation/galaxies';

import { cameraViewRect, viewToWorld } from '@pierre/ecs/modules/camera';

import { GALAXY_SPRITE_SCALE, PICK_PX } from './config/render';
import { galaxiesInRect } from './generation/galaxies';
import { NameDef } from './generation/naming';

export type BodyKind = 'black-hole' | 'moon' | 'planet' | 'star';

export interface PickResult {
  id: EntityId;
  kind: BodyKind;
}

/** A picked galaxy (galaxy-field tier); carries its data directly (no entity). */
export interface GalaxyPick {
  galaxy: GalaxyParams;
  kind: 'galaxy';
}

/** The picked universe root (from the location tree); carries the world seed. */
export interface UniversePick {
  kind: 'universe';
  seed: number;
}

/** The current inspector selection: an entity body, a galaxy, or the universe. */
export type Selection = GalaxyPick | PickResult | UniversePick;

/**
 * The streamed entity carrying `name` (a unique seed-derived catalogue name), or
 * `null`. Used to turn a location-tree node back into the body it names so a
 * click pins the same inspector selection a canvas pick would.
 */
export function findEntityByName(world: EcsWorld, name: string): EntityId | null {
  for (const [id, n] of world.query(NameDef)) {
    if (n.scientific === name)
      return id;
  }
  return null;
}

/**
 * Find the galaxy whose disc holds the cursor at the galaxy-field tier, or
 * `null`. `localCam` is in the floating render-origin frame; galaxy centres are
 * absolute, so the cursor is unprojected and shifted back by the render origin.
 */
export function pickGalaxyAt(worldSeed: number, localCam: Camera, originX: number, originY: number, bx: number, by: number): GalaxyParams | null {
  const { wx, wy } = viewToWorld(bx, by, localCam);
  const ax = wx + originX;
  const ay = wy + originY;
  const halo = PICK_PX / localCam.zoom;
  const rect = cameraViewRect(localCam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;

  let best: GalaxyParams | null = null;
  let bestDist = Infinity;
  for (const g of galaxiesInRect(worldSeed, minX, minY, minX + rect.w, minY + rect.h)) {
    const dist = Math.hypot(g.centerX - ax, g.centerY - ay);
    const tolerance = Math.max(g.radius * GALAXY_SPRITE_SCALE, halo);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = g;
    }
  }
  return best;
}
