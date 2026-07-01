import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { GalaxyParams } from './generation/galaxies';

import { cameraViewRect, viewToWorld } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { GALAXY_SPRITE_SCALE, PICK_PX } from './config/render';
import { BlackHoleDef, galaxiesInRect } from './generation/galaxies';
import { NameDef } from './generation/naming';
import { PlanetPhysicalDef } from './generation/planets';
import { StarPhysicalDef } from './generation/stars';

export type BodyKind = 'black-hole' | 'planet' | 'star';

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
 * Find the body nearest the cursor within the pick tolerance, or `null`. Both
 * `bx`/`by` (canvas backing pixels) and the entity positions are in the floating
 * render-origin frame that `localCam` describes, so the cursor unprojects
 * straight into the same coordinates the stars and planets live in.
 *
 * Tolerance is the larger of the body's drawn disc radius and `PICK_PX` (in
 * world units), so large discs are click-anywhere while tiny ones still get a
 * forgiving screen-pixel halo. Stars and planets compete on equal footing; the
 * closest centre wins.
 */
export function pickBodyAt(world: EcsWorld, localCam: Camera, bx: number, by: number): PickResult | null {
  const { wx, wy } = viewToWorld(bx, by, localCam);
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  const haloWorld = PICK_PX / localCam.zoom;

  let best: PickResult | null = null;
  let bestDist = Infinity;

  const consider = (id: EntityId, kind: BodyKind): void => {
    const pos = positions.get(id);
    if (!pos)
      return;
    const dist = Math.hypot(pos.x - wx, pos.y - wy);
    const renderable = renderables.get(id);
    const discRadius = renderable?.kind === 'circle' ? renderable.radius : 0;
    const tolerance = Math.max(discRadius, haloWorld);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = { id, kind };
    }
  };

  for (const [id] of world.query(StarPhysicalDef))
    consider(id, 'star');
  for (const [id] of world.query(PlanetPhysicalDef))
    consider(id, 'planet');
  for (const [id] of world.query(BlackHoleDef))
    consider(id, 'black-hole');

  return best;
}

/**
 * The streamed entity carrying `name` (a unique seed-derived catalogue name), or
 * `null`. Used to turn a location-tree node back into the body it names so a
 * click pins the same inspector selection a canvas pick would.
 */
export function findEntityByName(world: EcsWorld, name: string): EntityId | null {
  for (const [id, n] of world.query(NameDef)) {
    if (n.name === name)
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
