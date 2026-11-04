import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { after } from '../pipeline';

/**
 * Advances the Three renderer's lifecycle and publishes whether it draws this
 * frame. While it loads, nothing is drawn behind the overlay. Every tier is a
 * perspective view with the same orbit / pan / flatten controls, so the
 * flatten toggle shows whenever Three draws.
 */
export function makeBackendSelectSystem(deps: {
  flattenButton: { setVisible: (visible: boolean) => void };
  state: FrameState;
  threeBackend: { update: () => boolean };
}): SchedulableSystem<FrameCtx> {
  const { flattenButton, state, threeBackend } = deps;
  return {
    name: 'backend-select',
    runAfter: after('backend-select'),
    run(ctx) {
      ctx.threeActive = threeBackend.update();

      if (ctx.threeActive !== state.lastFlattenVisible) {
        flattenButton.setVisible(ctx.threeActive);
        state.lastFlattenVisible = ctx.threeActive;
      }
    },
  };
}
