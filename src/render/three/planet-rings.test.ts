import { describe, expect, it } from 'vitest';

import { ringColor, ringDiversity, ringOuterRadius, ringVariety } from './planet-rings';

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

describe('ringColor', () => {
  it('makes cold rings icy blue-white and warm rings dusty/reddish', () => {
    const cold = ringColor(60);
    const warm = ringColor(600);
    // Cold: blue channel dominant and bright; warm: red dominant and darker.
    expect(cold[2]).toBeGreaterThan(cold[0]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cold[2]).toBeGreaterThan(warm[2]);
  });

  it('gets progressively redder (blue−red) from cold to hot', () => {
    const blueBias = (c: [number, number, number]): number => c[2] - c[0];
    expect(blueBias(ringColor(60))).toBeGreaterThan(blueBias(ringColor(250)));
    expect(blueBias(ringColor(250))).toBeGreaterThan(blueBias(ringColor(600)));
  });

  it('clamps beyond the temperature anchors', () => {
    expect(ringColor(0)).toEqual(ringColor(80));
    expect(ringColor(5000)).toEqual(ringColor(500));
  });
});

describe('ringDiversity', () => {
  it('produces 3 gap slots with at least one active gap', () => {
    const d = ringDiversity(30, 120);
    expect(d.gapCenters).toHaveLength(3);
    expect(d.gapWidths).toHaveLength(3);
    // Slot 0 is always an active gap (gapCount is 1..3).
    expect(d.gapCenters[0]).toBeGreaterThanOrEqual(0.2);
    expect(d.gapCenters[0]).toBeLessThanOrEqual(0.8);
    expect(d.gapWidths[0]).toBeGreaterThan(0);
  });

  it('keeps inner edge, opacity, and seed in range', () => {
    for (const [m, temp] of [[1, 90], [317, 60], [0.5, 400], [95, 130]]) {
      const d = ringDiversity(m, temp);
      expect(d.innerStart).toBeGreaterThanOrEqual(0.4);
      expect(d.innerStart).toBeLessThanOrEqual(0.6);
      expect(d.opacity).toBeGreaterThanOrEqual(0.4);
      expect(d.opacity).toBeLessThanOrEqual(0.7);
      expect(d.seed).toBeGreaterThanOrEqual(0);
      expect(d.seed).toBeLessThan(1);
    }
  });

  it('marks unused gap slots with centre -1 and width 0', () => {
    const d = ringDiversity(30, 120);
    for (let i = 0; i < 3; i++) {
      if (d.gapCenters[i] === -1)
        expect(d.gapWidths[i]).toBe(0);
      else
        expect(d.gapCenters[i]).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('is deterministic for the same inputs', () => {
    expect(ringDiversity(12.3, 45.6)).toEqual(ringDiversity(12.3, 45.6));
  });
});
