import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { SelectionState } from '../../selection-state';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { selectTier } from '../../lod/tier';
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
      const tier = selectTier(camera, state.currentTier);
      ctx.tierChanged = tier !== state.currentTier;
      ctx.tier = tier;
      state.currentTier = tier;
    },
  };
}

/** Flags what moved since the last frame and snapshots the camera for the next one. */
export function makeChangeDetectSystem(deps: {
  camera: Camera;
  selectionState: Pick<SelectionState, 'selection'>;
  state: FrameState;
}): SchedulableSystem<FrameCtx> {
  const { camera, selectionState, state } = deps;
  return {
    name: 'change-detect',
    runAfter: after('change-detect'),
    run(ctx) {
      ctx.camMoved = camera.x !== state.lastCamX || camera.y !== state.lastCamY || camera.zoom !== state.lastCamZoom;
      state.lastCamX = camera.x;
      state.lastCamY = camera.y;
      state.lastCamZoom = camera.zoom;
      ctx.vpChanged = camera.viewportW !== state.lastVpW || camera.viewportH !== state.lastVpH;
      state.lastVpW = camera.viewportW;
      state.lastVpH = camera.viewportH;
      const selection = selectionState.selection;
      ctx.selChanged = selection !== state.lastSelection;
      state.lastSelection = selection;
    },
  };
}
