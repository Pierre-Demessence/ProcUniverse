import { describe, expect, it } from 'vitest';

import { ringOuterRadius, ringVariety } from './planet-rings';

describe('ringVariety', () => {
  it('stays within [0, 1)', () => {
    for (const [a, b] of [[1, 255], [317.4, 42.1], [0, 0], [9999, 0.01]]) {
      const v = ringVariety(a, b);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same inputs', () => {
    expect(ringVariety(12.3, 45.6)).toBe(ringVariety(12.3, 45.6));
  });

  it('differs for different inputs', () => {
    expect(ringVariety(1, 2)).not.toBe(ringVariety(2, 1));
  });
});

describe('ringOuterRadius', () => {
  it('scales the ring between ~1.9 and ~2.4 planetary radii', () => {
    const planet = 3;
    expect(ringOuterRadius(planet, 0)).toBeCloseTo(planet * 1.9);
    expect(ringOuterRadius(planet, 1)).toBeCloseTo(planet * 2.4);
    const mid = ringOuterRadius(planet, 0.5);
    expect(mid).toBeGreaterThan(planet * 1.9);
    expect(mid).toBeLessThan(planet * 2.4);
  });

  it('grows with variety and with planet radius', () => {
    expect(ringOuterRadius(1, 0.9)).toBeGreaterThan(ringOuterRadius(1, 0.1));
    expect(ringOuterRadius(2, 0.5)).toBeCloseTo(2 * ringOuterRadius(1, 0.5));
  });
});
