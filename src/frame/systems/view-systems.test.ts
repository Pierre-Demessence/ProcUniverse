import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it, vi } from 'vitest';

import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeLockRecentreSystem, makeSimClockSystem, makeTierSelectSystem } from './view-systems';

const cam = (zoom: number) => makeCamera({ viewportH: 1000, viewportW: 1000, x: 0, y: 0, zoom });

describe('sim-clock system', () => {
  it('advances sim time by dt scaled by the time scale and samples frame stats', () => {
    const state = new FrameState({ simSeconds: 10, tier: 'system' });
    const sample = vi.fn();
    makeSimClockSystem(state, { timeScale: 60 }, { sample }).run(createFrameCtx(500, 'system'));
    expect(state.simSeconds).toBeCloseTo(10 + 30);
    expect(sample).toHaveBeenCalledWith(500);
  });
});

describe('lock-recentre system', () => {
  const state = new FrameState({ simSeconds: 5, tier: 'system' });

  it('centres the camera on the locked body and forwards its height', () => {
    const camera = cam(1);
    const setFocusZ = vi.fn();
    const lockedPosition = vi.fn(() => ({ x: 3, y: 4, z: 7 }));
    makeLockRecentreSystem({ camera, controller: { setFocusZ }, selectionState: { lockedPosition }, state, world: new EcsWorld() }).run(createFrameCtx(16, 'system'));
    expect(lockedPosition).toHaveBeenCalledWith(expect.anything(), 5);
    expect([camera.x, camera.y]).toEqual([3, 4]);
    expect(setFocusZ).toHaveBeenCalledWith(7);
  });

  it('leaves the camera alone when nothing is locked', () => {
    const camera = cam(1);
    camera.x = 9;
    const setFocusZ = vi.fn();
    makeLockRecentreSystem({ camera, controller: { setFocusZ }, selectionState: { lockedPosition: () => null }, state, world: new EcsWorld() }).run(createFrameCtx(16, 'system'));
    expect(camera.x).toBe(9);
    expect(setFocusZ).not.toHaveBeenCalled();
  });
});

describe('tier-select system', () => {
  it('selects the tier for the zoom and stores it', () => {
    const camera = cam(1e12);
    const state = new FrameState({ simSeconds: 0, tier: 'universe' });
    const system = makeTierSelectSystem(camera, state);

    const first = createFrameCtx(16, 'universe');
    system.run(first);
    expect(first.tier).toBe('system');
    expect(state.currentTier).toBe('system');
  });
});
