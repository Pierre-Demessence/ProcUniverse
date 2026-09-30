import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { LY_PER_SECTOR } from '../config/data';
import { GALAXY_FIELD_SECTORS, GALAXY_TIER_SECTORS, STAR_BLEND_MAX_AU, STAR_BLEND_MIN_AU, STAR_HANDOFF_START, STAR_MAX_REACH_LY, STAR_TILT_EASE_START_SECTORS, SYSTEM_TIER_MAX_AU, TIER_HYSTERESIS, UNIVERSE_SECTORS } from '../config/render';
import { SECTOR_SIZE } from '../scale';
import { SECTOR_CACHE_CAPACITY } from './sector-cache';
import { layerWeights, sectorsAround, selectTier, starTierTiltScale, tierBlend } from './tier';

// A camera whose larger viewport axis spans `across` sectors.
function camAcross(across: number): ReturnType<typeof makeCamera> {
  const viewportW = 800;
  const viewportH = 600;
  const zoom = Math.max(viewportW, viewportH) / (across * SECTOR_SIZE);
  return makeCamera({ viewportH, viewportW, x: 0, y: 0, zoom });
}

describe('selectTier', () => {
  const STAR_AT = SYSTEM_TIER_MAX_AU / SECTOR_SIZE;

  it('selects each tier by zoom (sectors across)', () => {
    // Sample a value comfortably inside each tier's band, derived from the
    // boundary constants so the test tracks any rescale of the spatial model.
    expect(selectTier(camAcross(STAR_AT * 0.4), 'system')).toBe('system');
    expect(selectTier(camAcross(Math.sqrt(STAR_AT * GALAXY_TIER_SECTORS)), 'system')).toBe('star');
    expect(selectTier(camAcross(Math.sqrt(GALAXY_TIER_SECTORS * GALAXY_FIELD_SECTORS)), 'system')).toBe('galaxy');
    expect(selectTier(camAcross(Math.sqrt(GALAXY_FIELD_SECTORS * UNIVERSE_SECTORS)), 'system')).toBe('galaxy-field');
    expect(selectTier(camAcross(UNIVERSE_SECTORS * 2), 'system')).toBe('universe');
  });

  it('holds the previous tier within the hysteresis dead-band at a boundary', () => {
    const nearGalaxy = GALAXY_TIER_SECTORS * 1.1; // just past the star → galaxy edge
    expect(selectTier(camAcross(nearGalaxy), 'star')).toBe('star');
    expect(selectTier(camAcross(nearGalaxy), 'galaxy')).toBe('galaxy');
  });
});

describe('tierBlend', () => {
  const auAcross = (au: number): ReturnType<typeof makeCamera> => camAcross(au / SECTOR_SIZE);

  it('is 0 inside the system view, 1 in the star field, and rises monotonically between', () => {
    expect(tierBlend(auAcross(STAR_BLEND_MIN_AU * 0.5))).toBe(0);
    expect(tierBlend(auAcross(STAR_BLEND_MAX_AU * 2))).toBe(1);
    let prev = 0;
    for (let au = STAR_BLEND_MIN_AU; au <= STAR_BLEND_MAX_AU; au *= 1.1) {
      const b = tierBlend(auAcross(au));
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('encloses the system/star hysteresis band, so systems stay streamed wherever their layer shows', () => {
    // Zooming out, the tier flips to star at SYSTEM_TIER_MAX_AU·H; zooming in it
    // flips back at SYSTEM_TIER_MAX_AU/H. Both must sit strictly inside the band.
    expect(STAR_BLEND_MIN_AU).toBeLessThan(SYSTEM_TIER_MAX_AU / TIER_HYSTERESIS);
    expect(STAR_BLEND_MAX_AU).toBeGreaterThan(SYSTEM_TIER_MAX_AU * TIER_HYSTERESIS);
    const atFlip = tierBlend(auAcross(SYSTEM_TIER_MAX_AU));
    expect(atFlip).toBeGreaterThan(0);
    expect(atFlip).toBeLessThan(1);
  });
});

describe('layerWeights', () => {
  it('shows only the system layer at 0 and only stars at 1', () => {
    expect(layerWeights(0)).toEqual({ bodies: 1, focusedSphere: 1, focusedSprite: 0, stars: 0 });
    expect(layerWeights(1)).toEqual({ bodies: 0, focusedSphere: 0, focusedSprite: 1, stars: 1 });
  });

  it('keeps the focused star a sphere until the handoff, then trades sphere for sprite', () => {
    const before = layerWeights(STAR_HANDOFF_START * 0.9);
    expect(before.focusedSphere).toBe(1);
    expect(before.focusedSprite).toBe(0);
    const mid = layerWeights((STAR_HANDOFF_START + 1) / 2);
    expect(mid.focusedSphere + mid.focusedSprite).toBeCloseTo(1);
    expect(mid.focusedSprite).toBeGreaterThan(0);
  });
});

describe('starTierTiltScale', () => {
  it('keeps the tilt near the system view and eases it to top-down at the galaxy boundary', () => {
    expect(starTierTiltScale(camAcross(STAR_TILT_EASE_START_SECTORS / 2))).toBe(1);
    expect(starTierTiltScale(camAcross(GALAXY_TIER_SECTORS))).toBe(0);
    const mid = starTierTiltScale(camAcross(Math.sqrt(STAR_TILT_EASE_START_SECTORS * GALAXY_TIER_SECTORS)));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('sectorsAround', () => {
  it('covers the square around a point, across negative coordinates', () => {
    expect(sectorsAround(0, SECTOR_SIZE * 2.5, SECTOR_SIZE)).toEqual({ maxSx: 1, maxSy: 3, minSx: -1, minSy: 1 });
  });
});

describe('star-tier reach', () => {
  it('keeps the widest star-field range inside the sector cache', () => {
    // A range of reach r spans at most (2·ceil(r) + 2)² sectors; evicting any of
    // them while still in view would regenerate sectors every frame.
    const side = 2 * Math.ceil(STAR_MAX_REACH_LY / LY_PER_SECTOR) + 2;
    expect(side * side).toBeLessThan(SECTOR_CACHE_CAPACITY);
  });
});
