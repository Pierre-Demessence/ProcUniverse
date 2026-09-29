import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it, vi } from 'vitest';

import { cameraAbsolute } from '../../camera/origin';
import { REBASE_SECTORS } from '../../config/render';
import { SECTOR_SIZE } from '../../scale';
import { createFrameCtx } from '../frame-context';
import { FrameState } from '../frame-state';
import { makeOrbitsSystem, makeOriginRebaseSystem, makePendingBookmarkSystem, makeStreamingSystem } from './world-systems';

const camera = (x: number, y: number, zoom: number) => makeCamera({ viewportH: 1000, viewportW: 1000, x, y, zoom });
const emptyCache = { get: () => ({ systems: [] }) } as never;

describe('origin-rebase system', () => {
  it('does nothing on a clean frame', () => {
    const cam = camera(0, 0, 1e12);
    const clear = vi.fn();
    const ctx = createFrameCtx(16, 'system');
    makeOriginRebaseSystem({ cache: emptyCache, camera: cam, state: new FrameState({ simSeconds: 0, tier: 'system' }), streamer: { clear } }).run(ctx);
    expect(clear).not.toHaveBeenCalled();
    expect(ctx.camAbsX).toBe(0);
  });

  it('anchors the origin to the focused star at the system tier without moving the absolute camera', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'system' });
    const cam = camera(1, 2, 1e12);
    const star = { x: 5000, y: 6000 };
    const cache = { get: () => ({ systems: [star] }) } as never;
    const clear = vi.fn();
    const ctx = createFrameCtx(16, 'system');
    ctx.dirty = true;
    makeOriginRebaseSystem({ cache, camera: cam, state, streamer: { clear } }).run(ctx);
    expect([state.renderOriginX, state.renderOriginY]).toEqual([5000, 6000]);
    expect(cameraAbsolute(state.renderOriginX, cam.x)).toBeCloseTo(1);
    expect(cameraAbsolute(state.renderOriginY, cam.y)).toBeCloseTo(2);
    expect(ctx.focusedSystem).toBe(star);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('rebases zoomed out only once the local offset grows past the threshold', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'universe' });
    const clear = vi.fn();
    const near = camera(SECTOR_SIZE, 0, 1e-30);
    const ctxNear = createFrameCtx(16, 'universe');
    ctxNear.dirty = true;
    makeOriginRebaseSystem({ cache: emptyCache, camera: near, state, streamer: { clear } }).run(ctxNear);
    expect(state.renderOriginX).toBe(0);
    expect(clear).not.toHaveBeenCalled();

    const far = camera(SECTOR_SIZE * (REBASE_SECTORS + 1), 0, 1e-30);
    const ctxFar = createFrameCtx(16, 'universe');
    ctxFar.dirty = true;
    makeOriginRebaseSystem({ cache: emptyCache, camera: far, state, streamer: { clear } }).run(ctxFar);
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
    return { state, streamer, system: makeStreamingSystem({ state, streamer, world }), world };
  };

  it('streams at the system tier and flushes the world', () => {
    const { streamer, system, world } = setup();
    const ctx = createFrameCtx(16, 'system');
    ctx.dirty = true;
    system.run(ctx);
    expect(streamer.update).toHaveBeenCalledWith(ctx.range, 3, 4);
    expect(streamer.clear).not.toHaveBeenCalled();
    expect(world.endOfTick).toHaveBeenCalledOnce();
  });

  it('despawns at any other tier and still flushes', () => {
    const { streamer, system, world } = setup();
    const ctx = createFrameCtx(16, 'star');
    ctx.dirty = true;
    system.run(ctx);
    expect(streamer.clear).toHaveBeenCalledOnce();
    expect(streamer.update).not.toHaveBeenCalled();
    expect(world.endOfTick).toHaveBeenCalledOnce();
  });

  it('skips clean frames', () => {
    const { streamer, system, world } = setup();
    system.run(createFrameCtx(16, 'system'));
    expect(streamer.update).not.toHaveBeenCalled();
    expect(streamer.clear).not.toHaveBeenCalled();
    expect(world.endOfTick).not.toHaveBeenCalled();
  });
});

describe('orbits system', () => {
  it('runs only for dirty system-tier frames', () => {
    const state = new FrameState({ simSeconds: 0, tier: 'system' });
    const world = new EcsWorld();
    const system = makeOrbitsSystem(state, world);
    const clean = createFrameCtx(16, 'system');
    expect(() => system.run(clean)).not.toThrow();
    const star = createFrameCtx(16, 'star');
    star.dirty = true;
    expect(() => system.run(star)).not.toThrow();
  });
});

describe('pending-bookmark system', () => {
  const setup = (resolved: number | null) => {
    const world = new EcsWorld();
    world.registerComponent(PositionDef);
    const id = world.createEntity();
    world.getStore(PositionDef).set(id, { x: 8, y: 9 });
    const resolvePending = vi.fn(() => (resolved === null ? null : id));
    const cam = camera(0, 0, 1);
    return { cam, resolvePending, system: makePendingBookmarkSystem({ camera: cam, selectionState: { resolvePending }, world }) };
  };

  it('centres the camera on the resolved body at the system tier', () => {
    const { cam, system } = setup(1);
    const ctx = createFrameCtx(16, 'system');
    ctx.dirty = true;
    system.run(ctx);
    expect([cam.x, cam.y]).toEqual([8, 9]);
  });

  it('leaves the camera alone when nothing resolved', () => {
    const { cam, system } = setup(null);
    const ctx = createFrameCtx(16, 'system');
    ctx.dirty = true;
    system.run(ctx);
    expect([cam.x, cam.y]).toEqual([0, 0]);
  });

  it('does not resolve outside the system tier or on clean frames', () => {
    const { resolvePending, system } = setup(1);
    const star = createFrameCtx(16, 'star');
    star.dirty = true;
    system.run(star);
    system.run(createFrameCtx(16, 'system'));
    expect(resolvePending).not.toHaveBeenCalled();
  });
});
