import { describe, expect, it } from 'vitest';

import { BLOOM_THRESHOLD } from '../../config/render';
import { starBrightness, starIntensity, starScale, starTint } from './starfield';

describe('per-star appearance', () => {
  const uniforms = Array.from({ length: 1001 }, (_, i) => i / 1000);

  it('skews brightness toward the faint end', () => {
    const lo = starBrightness(0);
    const hi = starBrightness(1);
    expect(starBrightness(0.5)).toBeLessThan(lo + (hi - lo) * 0.25);
    for (let i = 1; i < uniforms.length; i++)
      expect(starBrightness(uniforms[i]!)).toBeGreaterThanOrEqual(starBrightness(uniforms[i - 1]!));
  });

  it('pushes only the brightest tail past the bloom threshold', () => {
    const blooming = uniforms.filter(u => starIntensity(starBrightness(u)) > BLOOM_THRESHOLD).length;
    expect(blooming).toBeGreaterThan(0);
    expect(blooming / uniforms.length).toBeLessThan(0.01);
    expect(starIntensity(0.5)).toBe(0.5);
  });

  it('grows sprite size with brightness', () => {
    let prev = 0;
    for (const u of uniforms) {
      const size = starScale(starBrightness(u));
      expect(size).toBeGreaterThanOrEqual(prev);
      prev = size;
    }
    expect(starScale(starBrightness(1))).toBeGreaterThan(starScale(starBrightness(0)) * 2);
  });

  it('keeps tints in range and mostly near white', () => {
    let nearWhite = 0;
    let total = 0;
    for (const u1 of uniforms.filter((_, i) => i % 10 === 0)) {
      for (const u2 of uniforms.filter((_, i) => i % 10 === 5)) {
        const t = starTint(u1, u2, 0.5);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        if (Math.abs(t - 0.5) < 0.2)
          nearWhite++;
        total++;
      }
    }
    expect(nearWhite / total).toBeGreaterThan(0.5);
  });

  it('leans tints with local activity', () => {
    expect(starTint(0.5, 0.5, 1)).toBeGreaterThan(starTint(0.5, 0.5, 0.5));
    expect(starTint(0.5, 0.5, 0)).toBeLessThan(starTint(0.5, 0.5, 0.5));
  });
});
