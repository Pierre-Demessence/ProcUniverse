import type { GalaxyParams } from './galaxies';

import { describe, expect, it } from 'vitest';

import { galaxyDensity, getGalaxy, makeGalaxy } from './galaxies';

const spiral: GalaxyParams = {
  arms: 2,
  armStrength: 0.7,
  ellipticity: 1,
  orientation: 0,
  phase: 0,
  pitch: (18 * Math.PI) / 180,
  radius: 1000,
  scaleLength: 300,
  type: 'spiral',
};

describe('galaxyDensity', () => {
  it('peaks at the core and vanishes beyond the radius', () => {
    expect(galaxyDensity(spiral, 0, 0)).toBe(1);
    expect(galaxyDensity(spiral, 2000, 0)).toBe(0);
    expect(galaxyDensity(spiral, 0, 2000)).toBe(0);
  });

  it('falls off with distance from the core', () => {
    expect(galaxyDensity(spiral, 100, 0)).toBeGreaterThan(galaxyDensity(spiral, 600, 0));
  });

  it('stays within [0, 1] across the disc', () => {
    for (let x = -1000; x <= 1000; x += 137) {
      for (let y = -1000; y <= 1000; y += 137) {
        const d = galaxyDensity(spiral, x, y);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('breaks rotational symmetry for spirals but not a circular elliptical', () => {
    const spiralVaries = Math.abs(galaxyDensity(spiral, 300, 0) - galaxyDensity(spiral, 0, 300));
    expect(spiralVaries).toBeGreaterThan(0.01);

    const circular: GalaxyParams = { ...spiral, ellipticity: 1, type: 'elliptical' };
    expect(galaxyDensity(circular, 300, 0)).toBeCloseTo(galaxyDensity(circular, 0, 300), 9);
  });

  it('squashes an elliptical galaxy along its minor axis', () => {
    const ell: GalaxyParams = { ...spiral, ellipticity: 0.5, orientation: 0, type: 'elliptical' };
    expect(galaxyDensity(ell, 300, 0)).toBeGreaterThan(galaxyDensity(ell, 0, 300));
  });
});

describe('makeGalaxy / getGalaxy', () => {
  it('is deterministic for a seed and varies by seed', () => {
    expect(makeGalaxy(7)).toEqual(makeGalaxy(7));
    expect(makeGalaxy(1)).not.toEqual(makeGalaxy(2));
  });

  it('produces a valid finite disc', () => {
    const g = makeGalaxy(42);
    expect(g.radius).toBeGreaterThan(0);
    expect(g.scaleLength).toBeGreaterThan(0);
    expect(g.arms).toBeGreaterThanOrEqual(2);
    expect(g.arms).toBeLessThanOrEqual(4);
    expect(['elliptical', 'spiral']).toContain(g.type);
  });

  it('memoises the current galaxy by seed', () => {
    expect(getGalaxy(5)).toBe(getGalaxy(5));
  });
});
