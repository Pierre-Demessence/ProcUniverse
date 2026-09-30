import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it, vi } from 'vitest';

import { cameraAbsolute } from '../../camera/origin';
import { REBASE_SECTORS } from '../../config/render';
import { SECTOR_SIZE } from '../../scale';
import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeOrbitsSystem, makeOriginRebaseSystem, makePendingBookmarkSystem, makeStreamingSystem } from './world-systems';

const camera = (x: number, y: number, zoom: number) => makeCamera({ viewportH: 1000, viewportW: 1000, x, y, zoom });
const emptyCache = { get: () => ({ systems: [] }) } as never;
function focusController(initial = 0): { focusZ: number; setFocusZ: (z: number) => void } {
  const c = { focusZ: initial, setFocusZ: (z: number) => {
    c.focusZ = z;
  } };
  return c;
}

describe('origin-rebase system', () => {
  it('anchors the origin to the focused star at the system tier without moving the absolute camera', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'system' });
    const cam = camera(1, 2, 1e12);
    const star = { x: 5000, y: 6000, z: 700 };
    const cache = { get: () => ({ systems: [star] }) } as never;
    const clear = vi.fn();
    const controller = focusController(3);
    const ctx = createFrameCtx(16, 'system');
    makeOriginRebaseSystem({ cache, camera: cam, controller, state, streamer: { clear } }).run(ctx);
    expect([state.renderOriginX, state.renderOriginY, state.renderOriginZ]).toEqual([5000, 6000, 700]);
    expect(cameraAbsolute(state.renderOriginX, cam.x)).toBeCloseTo(1);
    expect(cameraAbsolute(state.renderOriginY, cam.y)).toBeCloseTo(2);
    expect(cameraAbsolute(state.renderOriginZ, controller.focusZ)).toBeCloseTo(3);
    expect(ctx.focusedSystem).toBe(star);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('keeps the star anchor through the star-tier end of the cross-fade band', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'star' });
    const star = { x: 5000, y: 6000, z: 0 };
    const cache = { get: () => ({ systems: [star] }) } as never;
    const ctx = createFrameCtx(16, 'star');
    ctx.blend = 0.5;
    makeOriginRebaseSystem({ cache, camera: camera(1, 2, 1), controller: focusController(), state, streamer: { clear: vi.fn() } }).run(ctx);
    expect(ctx.focusedSystem).toBe(star);
    expect([state.renderOriginX, state.renderOriginY]).toEqual([5000, 6000]);
  });

  it('rebases zoomed out only once the local offset grows past the threshold', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'universe' });
    const clear = vi.fn();
    const near = camera(SECTOR_SIZE, 0, 1e-30);
    const ctxNear = createFrameCtx(16, 'universe');
    makeOriginRebaseSystem({ cache: emptyCache, camera: near, controller: focusController(), state, streamer: { clear } }).run(ctxNear);
    expect(state.renderOriginX).toBe(0);
    expect(clear).not.toHaveBeenCalled();

    const far = camera(SECTOR_SIZE * (REBASE_SECTORS + 1), 0, 1e-30);
    const ctxFar = createFrameCtx(16, 'universe');
    makeOriginRebaseSystem({ cache: emptyCache, camera: far, controller: focusController(), state, streamer: { clear } }).run(ctxFar);
    expect(state.renderOriginX).toBe(SECTOR_SIZE * (REBASE_SECTORS + 1));
    expect(far.x).toBeCloseTo(0);
    expect(clear).toHaveBeenCalledOnce();
  });
});

describe('streaming system', () => {
  const setup = () => {
    const streamer = { clear: vi.fn(), update: vi.fn() };
    const world = { endOfTick: vi.fn() };
    const state = new FrameState({ simSeconds: 0, tier: 'system' });
    state.renderOriginX = 3;
    state.renderOriginY = 4;
    state.renderOriginZ = 5;
    return { state, streamer, system: makeStreamingSystem({ state, streamer, world }), world };
  };

  it('streams at the system tier and flushes the world', () => {
    const { streamer, system, world } = setup();
    const ctx = createFrameCtx(16, 'system');
    system.run(ctx);
    expect(streamer.update).toHaveBeenCalledWith(ctx.range, 3, 4, 5);
    expect(streamer.clear).not.toHaveBeenCalled();
    expect(world.endOfTick).toHaveBeenCalledOnce();
  });

  it('keeps streaming at the star tier while the system layer is still fading out', () => {
    const { streamer, system } = setup();
    const ctx = createFrameCtx(16, 'star');
    ctx.blend = 0.9;
    system.run(ctx);
    expect(streamer.update).toHaveBeenCalledOnce();
    expect(streamer.clear).not.toHaveBeenCalled();
  });

  it('despawns once the system layer has faded out and still flushes', () => {
    const { streamer, system, world } = setup();
    const ctx = createFrameCtx(16, 'star');
    system.run(ctx);
    expect(streamer.clear).toHaveBeenCalledOnce();
    expect(streamer.update).not.toHaveBeenCalled();
    expect(world.endOfTick).toHaveBeenCalledOnce();
  });
});

describe('orbits system', () => {
  it('runs only while the system layer shows', () => {
    const system = makeOrbitsSystem(new FrameState({ simSeconds: 0, tier: 'system' }), new EcsWorld());
    expect(system.runIf?.(createFrameCtx(16, 'system'))).toBe(true);
    expect(system.runIf?.(createFrameCtx(16, 'star'))).toBe(false);
  });
});

describe('pending-bookmark system', () => {
  const setup = (resolved: number | null) => {
    const world = new EcsWorld();
    world.registerComponent(Position3DDef);
    const id = world.createEntity();
    world.getStore(Position3DDef).set(id, { x: 8, y: 9, z: 7 });
    const resolvePending = vi.fn(() => (resolved === null ? null : id));
    const cam = camera(0, 0, 1);
    const controller = focusController();
    return { cam, controller, resolvePending, system: makePendingBookmarkSystem({ camera: cam, controller, selectionState: { resolvePending }, world }) };
  };

  it('centres the camera on the resolved body at the system tier', () => {
    const { cam, controller, system } = setup(1);
    const ctx = createFrameCtx(16, 'system');
    system.run(ctx);
    expect([cam.x, cam.y, controller.focusZ]).toEqual([8, 9, 7]);
  });

  it('leaves the camera alone when nothing resolved', () => {
    const { cam, system } = setup(null);
    const ctx = createFrameCtx(16, 'system');
    system.run(ctx);
    expect([cam.x, cam.y]).toEqual([0, 0]);
  });

  it('runs only at the system tier', () => {
    const { system } = setup(1);
    expect(system.runIf?.(createFrameCtx(16, 'star'))).toBe(false);
    expect(system.runIf?.(createFrameCtx(16, 'system'))).toBe(true);
  });
});
