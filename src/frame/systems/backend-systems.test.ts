import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it, vi } from 'vitest';

import { GALAXY_TIER_SECTORS } from '../../config/render';
import { SECTOR_SIZE } from '../../scale';
import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeBackendSelectSystem } from './backend-systems';

function setup(active: boolean, sectorsAcross = 1) {
  const state = new FrameState({ simSeconds: 0, tier: 'star' });
  const setThreeSystemActive = vi.fn();
  const setTiltScale = vi.fn();
  const setVisible = vi.fn();
  const camera = makeCamera({ viewportH: 1000, viewportW: 1000, x: 0, y: 0, zoom: 1000 / (sectorsAcross * SECTOR_SIZE) });
  const system = makeBackendSelectSystem({
    camera,
    controller: { setThreeSystemActive, setTiltScale },
    flattenButton: { setVisible },
    state,
    threeBackend: { update: () => active },
  });
  return { setThreeSystemActive, setTiltScale, setVisible, state, system };
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
    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(true);

    system.run(createFrameCtx(16, 'galaxy'));
    expect(setVisible).toHaveBeenLastCalledWith(false);
    expect(setThreeSystemActive).toHaveBeenLastCalledWith(false);
  });

  it('eases the star-tier tilt to top-down at the galaxy boundary, and not elsewhere', () => {
    const near = setup(true, 1);
    near.system.run(createFrameCtx(16, 'star'));
    expect(near.setTiltScale).toHaveBeenLastCalledWith(1);
    const edge = setup(true, GALAXY_TIER_SECTORS);
    edge.system.run(createFrameCtx(16, 'star'));
    expect(edge.setTiltScale).toHaveBeenLastCalledWith(0);
    edge.system.run(createFrameCtx(16, 'system'));
    expect(edge.setTiltScale).toHaveBeenLastCalledWith(1);
  });

  it.each([true, false])('publishes Three active = %s on the context', (active) => {
    const { system } = setup(active);
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(ctx.threeActive).toBe(active);
  });
});
