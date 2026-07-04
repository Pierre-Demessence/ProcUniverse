import { describe, expect, it } from 'vitest';

import { clamp, starLightIntensity, starSurfaceParams } from './star-surface';

describe('clamp', () => {
  it('bounds below, within, and above', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
  });
});

describe('starSurfaceParams', () => {
  it('gives cool stars big high-contrast granules and prominent spots', () => {
    const cool = starSurfaceParams(3000);
    expect(cool.granulationScale).toBeCloseTo(4);
    expect(cool.granulationContrast).toBeCloseTo(0.18);
    expect(cool.spotIntensity).toBeCloseTo(0.25);
    expect(cool.limbDarkening).toBeCloseTo(0.5);
  });

  it('gives hot stars fine low-contrast mottling and few spots', () => {
    const hot = starSurfaceParams(10000);
    expect(hot.granulationScale).toBeCloseTo(10);
    expect(hot.granulationContrast).toBeCloseTo(0.07);
    expect(hot.spotIntensity).toBeCloseTo(0.05);
    expect(hot.limbDarkening).toBeCloseTo(0.75);
  });

  it('is monotonic in temperature across the range', () => {
    const cool = starSurfaceParams(3000);
    const mid = starSurfaceParams(6500);
    const hot = starSurfaceParams(10000);
    expect(mid.granulationScale).toBeGreaterThan(cool.granulationScale);
    expect(hot.granulationScale).toBeGreaterThan(mid.granulationScale);
    expect(mid.spotIntensity).toBeLessThan(cool.spotIntensity);
    expect(hot.spotIntensity).toBeLessThan(mid.spotIntensity);
  });

  it('clamps beyond the temperature range', () => {
    expect(starSurfaceParams(1000)).toEqual(starSurfaceParams(3000));
    expect(starSurfaceParams(50000)).toEqual(starSurfaceParams(10000));
  });
});

describe('starLightIntensity', () => {
  it('returns the base for a Sun-luminosity star', () => {
    expect(starLightIntensity(1, 1.1)).toBeCloseTo(1.1);
  });

  it('dims for low luminosity and brightens for high, both clamped', () => {
    const dim = starLightIntensity(0.001, 1.1);
    const bright = starLightIntensity(1e5, 1.1);
    expect(dim).toBeLessThan(1.1);
    expect(bright).toBeGreaterThan(1.1);
    // Clamped to [0.6, 1.6]·base.
    expect(starLightIntensity(1e-30, 1.1)).toBeCloseTo(0.6 * 1.1);
    expect(starLightIntensity(1e30, 1.1)).toBeCloseTo(1.6 * 1.1);
  });

  it('is monotonic in luminosity', () => {
    expect(starLightIntensity(10, 1.1)).toBeGreaterThan(starLightIntensity(1, 1.1));
    expect(starLightIntensity(100, 1.1)).toBeGreaterThan(starLightIntensity(10, 1.1));
  });
});
