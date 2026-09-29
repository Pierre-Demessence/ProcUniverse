import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { SectorCache } from '../../lod/sector-cache';
import type { SystemStreamer } from '../../lod/streaming';
import type { SelectionState } from '../../selection-state';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { cameraAbsolute, rebaseLocal } from '../../camera/origin';
import { REBASE_SECTORS } from '../../config/render';
import { nearestSystem } from '../../lod/nearest-system';
import { visibleSectors } from '../../lod/tier';
import { SECTOR_SIZE } from '../../scale';
import { updateOrbits } from '../../sim/orbits';
import { after } from '../pipeline';

const REBASE_DIST = SECTOR_SIZE * REBASE_SECTORS;

export const atSystemTier = (ctx: FrameCtx): boolean => ctx.tier === 'system';

/**
 * Rebases the render origin so the renderer always draws small, precise local
 * coordinates. At the system tier the origin snaps to the focused star,
 * dropping planet coords to tens of AU (at ~10^5 AU local, the GPU's float32
 * vertex positions jitter visibly). Zoomed out it snaps to the sector grid and
 * rebases only once the local offset grows large. When the origin moves,
 * `camera.x/y` shift by the same amount so the absolute position is unchanged,
 * and streamed systems are dropped to respawn against the new origin.
 */
export function makeOriginRebaseSystem(deps: {
  cache: Pick<SectorCache, 'get'>;
  camera: Camera;
  state: FrameState;
  streamer: Pick<SystemStreamer, 'clear'>;
}): SchedulableSystem<FrameCtx> {
  const { cache, camera, state, streamer } = deps;
  return {
    name: 'origin-rebase',
    runAfter: after('origin-rebase'),
    run(ctx) {
      // Absolute camera position, reconstructed only for sector indexing and the
      // origin decision (both tolerate the ~ULP error); the precise render path
      // keeps using the small local `camera.x/y`.
      ctx.camAbsX = cameraAbsolute(state.renderOriginX, camera.x);
      ctx.camAbsY = cameraAbsolute(state.renderOriginY, camera.y);
      ctx.range = visibleSectors({ ...camera, x: ctx.camAbsX, y: ctx.camAbsY });

      // The system the camera is over (system tier only): its star anchors the
      // origin and its disk normal anchors the 3D camera + pan.
      ctx.focusedSystem = ctx.tier === 'system' ? nearestSystem(cache, ctx.camAbsX, ctx.camAbsY) : null;

      let originX = state.renderOriginX;
      let originY = state.renderOriginY;
      if (ctx.tier === 'system') {
        originX = ctx.focusedSystem ? ctx.focusedSystem.x : Math.round(ctx.camAbsX / SECTOR_SIZE) * SECTOR_SIZE;
        originY = ctx.focusedSystem ? ctx.focusedSystem.y : Math.round(ctx.camAbsY / SECTOR_SIZE) * SECTOR_SIZE;
      }
      else if (Math.abs(camera.x) > REBASE_DIST || Math.abs(camera.y) > REBASE_DIST) {
        originX = Math.round(ctx.camAbsX / SECTOR_SIZE) * SECTOR_SIZE;
        originY = Math.round(ctx.camAbsY / SECTOR_SIZE) * SECTOR_SIZE;
      }
      if (originX !== state.renderOriginX || originY !== state.renderOriginY) {
        camera.x = rebaseLocal(state.renderOriginX, camera.x, originX);
        camera.y = rebaseLocal(state.renderOriginY, camera.y, originY);
        state.renderOriginX = originX;
        state.renderOriginY = originY;
        streamer.clear();
      }
    },
  };
}

/** Streams full systems at the system tier and despawns them otherwise. */
export function makeStreamingSystem(deps: {
  state: FrameState;
  streamer: Pick<SystemStreamer, 'clear' | 'update'>;
  world: Pick<EcsWorld, 'endOfTick'>;
}): SchedulableSystem<FrameCtx> {
  const { state, streamer, world } = deps;
  return {
    name: 'streaming',
    runAfter: after('streaming'),
    run(ctx) {
      if (ctx.tier === 'system')
        streamer.update(ctx.range, state.renderOriginX, state.renderOriginY);
      else
        streamer.clear();
      // Flush despawns and drop the (subscriber-less) lifecycle events the
      // spawns/despawns queued before anything reads the entity set. Orbits run
      // next in this same tick, so the flush must happen here.
      world.endOfTick();
    },
  };
}

export function makeOrbitsSystem(state: FrameState, world: EcsWorld): SchedulableSystem<FrameCtx> {
  return {
    name: 'orbits',
    runAfter: after('orbits'),
    runIf: atSystemTier,
    run() {
      updateOrbits(world, state.simSeconds);
    },
  };
}

/**
 * Resolves a pending bookmark inspect so the first rendered frame already shows
 * the body at its live orbital position (the bookmarked coords are stale for
 * orbiting bodies). Must run after streaming has spawned the sector's entities
 * and orbits have moved them to the current simulation time.
 */
export function makePendingBookmarkSystem(deps: {
  camera: Camera;
  selectionState: Pick<SelectionState, 'resolvePending'>;
  world: EcsWorld;
}): SchedulableSystem<FrameCtx> {
  const { camera, selectionState, world } = deps;
  const positions = world.getStore(Position3DDef);
  return {
    name: 'pending-bookmark',
    runAfter: after('pending-bookmark'),
    runIf: atSystemTier,
    run() {
      const resolved = selectionState.resolvePending(world);
      const pos = resolved === null ? undefined : positions.get(resolved);
      if (pos) {
        camera.x = pos.x;
        camera.y = pos.y;
      }
    },
  };
}
