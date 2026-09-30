import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { starTierTiltScale } from '../../lod/tier';
import { after } from '../pipeline';

/**
 * Advances the Three renderer's lifecycle and publishes whether it draws this
 * frame. While it loads, nothing is drawn behind the overlay.
 */
export function makeBackendSelectSystem(deps: {
  camera: Camera;
  controller: Pick<CameraController, 'setThreeSystemActive' | 'setTiltScale'>;
  flattenButton: { setVisible: (visible: boolean) => void };
  state: FrameState;
  threeBackend: { update: () => boolean };
}): SchedulableSystem<FrameCtx> {
  const { camera, controller, flattenButton, state, threeBackend } = deps;
  return {
    name: 'backend-select',
    runAfter: after('backend-select'),
    run(ctx) {
      ctx.threeActive = threeBackend.update();

      // Left-drag panning follows the tilted/orbited reference plane in the 3D
      // perspective views (system and star tiers); the map tiers keep the raw 2D
      // pan.
      const perspective = ctx.threeActive && (ctx.tier === 'system' || ctx.tier === 'star');
      controller.setThreeSystemActive(perspective);
      // Ease the star tier toward top-down as it nears the orthographic galaxy
      // view, so that swap does not jump angle.
      controller.setTiltScale(ctx.tier === 'star' ? starTierTiltScale(camera) : 1);

      // The flatten toggle only means something in the 3D views; the map tiers
      // are already top-down.
      const flattenVisible = perspective;
      if (flattenVisible !== state.lastFlattenVisible) {
        flattenButton.setVisible(flattenVisible);
        state.lastFlattenVisible = flattenVisible;
      }
    },
  };
}
