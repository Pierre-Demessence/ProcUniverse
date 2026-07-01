import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { GALAXY_FIELD_SECTORS, GALAXY_TIER_SECTORS, SYSTEM_TIER_MAX_AU, UNIVERSE_SECTORS } from '../config/render';
import { SECTOR_SIZE } from '../scale';
import { selectTier } from './tier';

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
