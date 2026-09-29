import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { BackendFrame } from '../../render/three-backend';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { after } from '../pipeline';

/**
 * Resolves which renderer draws this frame and finalises `dirty`.
 *
 * Three shows its canvas only once ready; while it loads, the 2D canvas stays
 * transparent (`threeMode`) so there is no flash of Canvas 2D content. If Three
 * cannot load or initialise, Canvas 2D takes over every tier.
 *
 * A frame is dirty when there is no cached scene to blit (startup, or a resize
 * cleared the canvas), the system tier animates, the tier cross-fades, the
 * backend changed, or the camera, viewport, or selection changed. Without the
 * cache-invalid check a still camera at a non-system tier would leave the
 * just-cleared canvas blank until the next interaction.
 */
export function makeBackendSelectSystem(deps: {
  controller: Pick<CameraController, 'setThreeSystemActive'>;
  flattenButton: { setVisible: (visible: boolean) => void };
  state: FrameState;
  threeBackend: { update: (wanted: boolean) => BackendFrame };
  wantThree: () => boolean;
}): SchedulableSystem<FrameCtx> {
  const { controller, flattenButton, state, threeBackend, wantThree } = deps;
  return {
    name: 'backend-select',
    runAfter: after('backend-select'),
    run(ctx) {
      const backend = threeBackend.update(wantThree());
      ctx.threeMode = backend.threeMode;
      ctx.threeActive = backend.active;
      ctx.backendChanged = backend.changed;

      // Left-drag panning follows the tilted/orbited ground plane only in the 3D
      // perspective system view; every other tier keeps the raw 2D pan.
      controller.setThreeSystemActive(ctx.threeActive && ctx.tier === 'system');

      // The flatten toggle only means something in the 3D system view; other
      // tiers are already top-down 2D.
      const flattenVisible = ctx.threeActive && ctx.tier === 'system';
      if (flattenVisible !== state.lastFlattenVisible) {
        flattenButton.setVisible(flattenVisible);
        state.lastFlattenVisible = flattenVisible;
      }

      ctx.dirty = !state.sceneCacheValid || ctx.tier === 'system' || ctx.tierChanged || ctx.camMoved || ctx.vpChanged || ctx.selChanged || state.fadeMsLeft > 0 || ctx.backendChanged || ctx.threeActive;
    },
  };
}
