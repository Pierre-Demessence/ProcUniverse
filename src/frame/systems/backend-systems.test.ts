import { describe, expect, it, vi } from 'vitest';

import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeBackendSelectSystem } from './backend-systems';

function setup(backend: { active: boolean; changed: boolean; threeMode: boolean }, prime?: (s: FrameState) => void) {
  const state = new FrameState({ simSeconds: 0, tier: 'star' });
  state.sceneCacheValid = true;
  prime?.(state);
  const setThreeSystemActive = vi.fn();
  const setVisible = vi.fn();
  const system = makeBackendSelectSystem({
    controller: { setThreeSystemActive },
    flattenButton: { setVisible },
    state,
    threeBackend: { update: () => backend },
    wantThree: () => true,
  });
  return { setThreeSystemActive, setVisible, state, system };
}

describe('backend-select system', () => {
  it('is clean for a still camera at a non-system tier with a valid cache in Canvas 2D mode', () => {
    const { system } = setup({ active: false, changed: false, threeMode: false });
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(ctx.dirty).toBe(false);
  });

  it.each([
    ['system tier animates', 'system' as const, {}, {}],
    ['cache invalid', 'star' as const, {}, { cacheInvalid: true }],
    ['backend changed', 'star' as const, { changed: true }, {}],
    ['Three active', 'star' as const, { active: true, threeMode: true }, {}],
  ])('is dirty when %s', (_label, tier, backend, extra) => {
    const { system } = setup({ active: false, changed: false, threeMode: false, ...backend }, (s) => {
      if ('cacheInvalid' in extra)
        s.sceneCacheValid = false;
    });
    const ctx = createFrameCtx(16, tier);
    system.run(ctx);
    expect(ctx.dirty).toBe(true);
  });

  it.each(['camMoved', 'vpChanged', 'selChanged'] as const)('is dirty when %s', (flag) => {
    const { system } = setup({ active: false, changed: false, threeMode: false });
    const ctx = createFrameCtx(16, 'star');
    ctx[flag] = true;
    system.run(ctx);
    expect(ctx.dirty).toBe(true);
  });

  it('is dirty while the tier cross-fade is running', () => {
    const { system } = setup({ active: false, changed: false, threeMode: false }, (s) => {
      s.fadeMsLeft = 10;
    });
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(ctx.dirty).toBe(true);
  });

  it('toggles the flatten button only when visibility changes', () => {
    const { setThreeSystemActive, setVisible, system } = setup({ active: true, changed: false, threeMode: true });
    system.run(createFrameCtx(16, 'system'));
    system.run(createFrameCtx(16, 'system'));
    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(setVisible).toHaveBeenCalledWith(true);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(true);

    system.run(createFrameCtx(16, 'star'));
    expect(setVisible).toHaveBeenLastCalledWith(false);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(false);
  });

  it('publishes the backend state on the context', () => {
    const { system } = setup({ active: false, changed: true, threeMode: true });
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect([ctx.threeActive, ctx.threeMode, ctx.backendChanged]).toEqual([false, true, true]);
  });
});
