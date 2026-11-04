import { describe, expect, it, vi } from 'vitest';

import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeBackendSelectSystem } from './backend-systems';

function setup(initiallyActive: boolean) {
  const state = new FrameState({ simSeconds: 0, tier: 'star' });
  const setVisible = vi.fn();
  let active = initiallyActive;
  const system = makeBackendSelectSystem({
    flattenButton: { setVisible },
    state,
    threeBackend: { update: () => active },
  });
  return { setVisible, state, system, setActive: (next: boolean) => {
    active = next;
  } };
}

describe('backend-select system', () => {
  it('shows the flatten button at every tier while Three draws, toggling only on change', () => {
    const { setVisible, system } = setup(true);
    for (const tier of ['system', 'star', 'galaxy', 'galaxy-field', 'universe'] as const)
      system.run(createFrameCtx(16, tier));
    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(setVisible).toHaveBeenCalledWith(true);
  });

  it('hides the flatten button while Three is not drawing, and shows it again once it is', () => {
    const { setActive, setVisible, system } = setup(false);
    system.run(createFrameCtx(16, 'system'));
    expect(setVisible).not.toHaveBeenCalled();
    setActive(true);
    system.run(createFrameCtx(16, 'system'));
    expect(setVisible).toHaveBeenLastCalledWith(true);
    setActive(false);
    system.run(createFrameCtx(16, 'system'));
    expect(setVisible).toHaveBeenLastCalledWith(false);
  });

  it.each([true, false])('publishes Three active = %s on the context', (active) => {
    const { system } = setup(active);
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(ctx.threeActive).toBe(active);
  });
});
