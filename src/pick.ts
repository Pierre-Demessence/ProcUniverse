import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { GalaxyParams } from './generation/galaxies';
import type { ScreenProjector } from './render/draw-labels';

import { cameraViewRect } from '@pierre/ecs/modules/camera';

import { GALAXY_SPRITE_SCALE, PICK_PX } from './config/render';
import { galaxiesInBox } from './generation/galaxies';
import { NameDef } from './generation/naming';
import { galaxyFieldHalfDepth } from './lod/tier';

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
 * Find the galaxy whose sprite holds the cursor at the galaxy-field tier, or
 * `null`. `localCam` is in the floating render-origin frame; galaxy centres are
 * absolute, so they are shifted back by the render origin and projected through
 * `project` (the perspective camera that draws them). Candidates come from the
 * box of space in view around the focus height `focusZ` (absolute AU), matching
 * what the tier draws (`galaxyFieldHalfDepth`). The nearest on screen wins.
 */
export function pickGalaxyAt(worldSeed: number, localCam: Camera, originX: number, originY: number, originZ: number, focusZ: number, bx: number, by: number, project: ScreenProjector): GalaxyParams | null {
  const rect = cameraViewRect(localCam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;

  let best: GalaxyParams | null = null;
  let bestDist = Infinity;
  const screen = { pxPerAu: 0, sx: 0, sy: 0 };
  const halfDepth = galaxyFieldHalfDepth(localCam);
  for (const g of galaxiesInBox(worldSeed, minX, minY, focusZ - halfDepth, minX + rect.w, minY + rect.h, focusZ + halfDepth)) {
    if (!project(g.centerX - originX, g.centerY - originY, g.centerZ - originZ, screen))
      continue;
    const dist = Math.hypot(screen.sx - bx, screen.sy - by);
    const tolerance = Math.max(g.radius * GALAXY_SPRITE_SCALE * screen.pxPerAu, PICK_PX);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = g;
    }
  }
  return best;
}
