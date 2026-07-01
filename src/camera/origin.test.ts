import { describe, expect, it } from 'vitest';

import { cameraAbsolute, rebaseLocal } from './origin';

const SECTOR = 63241;

describe('cameraAbsolute', () => {
  it('adds the local offset to the origin', () => {
    expect(cameraAbsolute(1e13, 42)).toBe(1e13 + 42);
    expect(cameraAbsolute(0, -5)).toBe(-5);
  });
});

describe('rebaseLocal', () => {
  it('preserves the absolute position when the origin moves', () => {
    const origin = SECTOR * 1000;
    const local = 1234.5;
    const newOrigin = SECTOR * 1002;
    const newLocal = rebaseLocal(origin, local, newOrigin);
    expect(cameraAbsolute(newOrigin, newLocal)).toBeCloseTo(cameraAbsolute(origin, local), 6);
  });

  it('is a no-op when the origin does not change', () => {
    expect(rebaseLocal(1e13, 7, 1e13)).toBe(7);
  });
});

describe('pan precision (why the camera coordinate is stored local)', () => {
  it('accumulates small pan deltas a huge absolute coordinate would lose', () => {
    const origin = 1e13; // a far galaxy
    const delta = 1e-4; // one pan step in AU, below the ULP of `origin`
    const steps = 1000;

    // Old model — panning a huge ABSOLUTE coordinate: each delta is below the
    // float64 ULP, rounds away, and nothing moves.
    let absolute = origin;
    for (let i = 0; i < steps; i++)
      absolute -= delta;
    expect(absolute).toBe(origin);

    // New model — panning the small LOCAL offset: every delta lands.
    let local = 0;
    for (let i = 0; i < steps; i++)
      local -= delta;
    expect(local).toBeCloseTo(-steps * delta, 10);
    expect(cameraAbsolute(origin, local)).toBeLessThan(origin);
  });
});
