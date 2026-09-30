import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { SelectionState } from '../../selection-state';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { selectTier, tierBlend } from '../../lod/tier';
import { after } from '../pipeline';

interface SampledStats { sample: (dtMs: number) => void }
interface ScaledTime { readonly timeScale: number }

export function makeSimClockSystem(state: FrameState, time: ScaledTime, stats: SampledStats): SchedulableSystem<FrameCtx> {
  return {
    name: 'sim-clock',
    run(ctx) {
      state.simSeconds += (ctx.dtMs / 1000) * time.timeScale;
      stats.sample(ctx.dtMs);
    },
  };
}

/**
 * Re-centres the camera on the locked body before anything else reads it, so
 * the tier, origin, streaming, and render all agree on the view. Zoom is not
 * changed. `focusZ` carries the body's out-of-plane height so the 3D camera
 * looks at its true position, and is kept on unlock so the view doesn't jump.
 */
export function makeLockRecentreSystem(deps: {
  camera: Camera;
  controller: Pick<CameraController, 'setFocusZ'>;
  selectionState: Pick<SelectionState, 'lockedPosition'>;
  state: Pick<FrameState, 'simSeconds'>;
  world: EcsWorld;
}): SchedulableSystem<FrameCtx> {
  return {
    name: 'lock-recentre',
    runAfter: after('lock-recentre'),
    run() {
      const pos = deps.selectionState.lockedPosition(deps.world, deps.state.simSeconds);
      if (!pos)
        return;
      deps.camera.x = pos.x;
      deps.camera.y = pos.y;
      deps.controller.setFocusZ(pos.z);
    },
  };
}

export function makeTierSelectSystem(camera: Camera, state: FrameState): SchedulableSystem<FrameCtx> {
  return {
    name: 'tier-select',
    runAfter: after('tier-select'),
    run(ctx) {
      ctx.tier = selectTier(camera, state.currentTier);
      state.currentTier = ctx.tier;
      ctx.blend = tierBlend(camera);
    },
  };
}
