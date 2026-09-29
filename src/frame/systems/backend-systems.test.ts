import { describe, expect, it, vi } from 'vitest';

import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeBackendSelectSystem } from './backend-systems';

function setup(active: boolean) {
  const state = new FrameState({ simSeconds: 0, tier: 'star' });
  const setThreeSystemActive = vi.fn();
  const setVisible = vi.fn();
  const system = makeBackendSelectSystem({
    controller: { setThreeSystemActive },
    flattenButton: { setVisible },
    state,
    threeBackend: { update: () => active },
  });
  return { setThreeSystemActive, setVisible, state, system };
}

describe('backend-select system', () => {
  it('toggles the flatten button only when visibility changes', () => {
    const { setThreeSystemActive, setVisible, system } = setup(true);
    system.run(createFrameCtx(16, 'system'));
    system.run(createFrameCtx(16, 'system'));
    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(setVisible).toHaveBeenCalledWith(true);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(true);

    system.run(createFrameCtx(16, 'star'));
    expect(setVisible).toHaveBeenLastCalledWith(false);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(false);
  });

  it.each([true, false])('publishes Three active = %s on the context', (active) => {
    const { system } = setup(active);
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(ctx.threeActive).toBe(active);
  });
});
