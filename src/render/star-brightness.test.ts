import { describe, expect, it } from 'vitest';

import { BLOOM_THRESHOLD, STAR_SPRITE_MAX_PX, STAR_SPRITE_MIN_INTENSITY, STAR_SPRITE_MIN_PX, STAR_SPRITE_PEAK_INTENSITY } from '../config/render';
import { AU_PER_LY } from '../generation/units';
import { apparentStarLevel, boostSaturation, starSpriteIntensity, starSpriteSizePx } from './star-brightness';

describe('apparentStarLevel', () => {
  it('falls with distance and rises with luminosity', () => {
    const sunAt1Ly = apparentStarLevel(1, AU_PER_LY);
    expect(apparentStarLevel(1, 4 * AU_PER_LY)).toBeLessThan(sunAt1Ly);
    expect(apparentStarLevel(10, AU_PER_LY)).toBeGreaterThan(sunAt1Ly);
  });

  it('follows the inverse-square law: 10× luminosity at √10× distance looks the same', () => {
    expect(apparentStarLevel(10, Math.sqrt(10) * 3 * AU_PER_LY)).toBeCloseTo(apparentStarLevel(1, 3 * AU_PER_LY), 10);
  });

  it('clamps to [0, 1] and survives zero distance or luminosity', () => {
    expect(apparentStarLevel(1, 100)).toBe(1);
    expect(apparentStarLevel(1e-5, 1e4 * AU_PER_LY)).toBe(0);
    expect(apparentStarLevel(1, 0)).toBe(1);
    expect(apparentStarLevel(0, AU_PER_LY)).toBe(0);
  });
});

describe('sprite intensity and size', () => {
  it('span the configured range, and the brightest stars bloom while the faintest do not', () => {
    expect(starSpriteIntensity(0)).toBe(STAR_SPRITE_MIN_INTENSITY);
    expect(starSpriteIntensity(1)).toBe(STAR_SPRITE_PEAK_INTENSITY);
    expect(starSpriteIntensity(1)).toBeGreaterThan(BLOOM_THRESHOLD);
    expect(starSpriteIntensity(0)).toBeLessThan(BLOOM_THRESHOLD);
    expect(starSpriteSizePx(0)).toBe(STAR_SPRITE_MIN_PX);
    expect(starSpriteSizePx(1)).toBe(STAR_SPRITE_MAX_PX);
  });

  it('are monotonic in level', () => {
    let prevI = -Infinity;
    let prevS = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      expect(starSpriteIntensity(t)).toBeGreaterThan(prevI);
      expect(starSpriteSizePx(t)).toBeGreaterThan(prevS);
      prevI = starSpriteIntensity(t);
      prevS = starSpriteSizePx(t);
    }
  });
});

describe('boostSaturation', () => {
  it('leaves grey alone and pushes a tint away from grey within [0, 1]', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(boostSaturation(0.5, 0.5, 0.5, out)).toEqual([0.5, 0.5, 0.5]);
    const [r, , b] = boostSaturation(1, 0.8, 0.6, out);
    expect(r).toBe(1);
    expect(b).toBeLessThan(0.6);
    expect(b).toBeGreaterThanOrEqual(0);
  });
});
