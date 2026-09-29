import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { after } from '../pipeline';

/**
 * Advances the Three renderer's lifecycle and publishes whether it draws this
 * frame. While it loads, nothing is drawn behind the overlay.
 */
export function makeBackendSelectSystem(deps: {
  controller: Pick<CameraController, 'setThreeSystemActive'>;
  flattenButton: { setVisible: (visible: boolean) => void };
  state: FrameState;
  threeBackend: { update: () => boolean };
}): SchedulableSystem<FrameCtx> {
  const { controller, flattenButton, state, threeBackend } = deps;
  return {
    name: 'backend-select',
    runAfter: after('backend-select'),
    run(ctx) {
      ctx.threeActive = threeBackend.update();

      // Left-drag panning follows the tilted/orbited ground plane only in the 3D
      // perspective system view; every other tier keeps the raw 2D pan.
      controller.setThreeSystemActive(ctx.threeActive && ctx.tier === 'system');

      // The flatten toggle only means something in the 3D system view; other
      // tiers are already top-down.
      const flattenVisible = ctx.threeActive && ctx.tier === 'system';
      if (flattenVisible !== state.lastFlattenVisible) {
        flattenButton.setVisible(flattenVisible);
        state.lastFlattenVisible = flattenVisible;
      }
    },
  };
}
