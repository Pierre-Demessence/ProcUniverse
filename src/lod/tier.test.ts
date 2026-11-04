import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { GALAXY_CELL_LY, LY_PER_SECTOR } from '../config/data';
import { GALAXY_FIELD_LY, GALAXY_TIER_LY, STAR_BLEND_MAX_AU, STAR_BLEND_MIN_AU, STAR_HANDOFF_START, STAR_MAX_REACH_LY, STAR_MIN_REACH_LY, STAR_REACH_SPAN_FACTOR, STAR_TILT_EASE_START_LY, SYSTEM_TIER_MAX_AU, TIER_HYSTERESIS, UNIVERSE_LY } from '../config/render';
import { AU_PER_LY } from '../generation/units';
import { SECTOR_SIZE } from '../scale';
import { SECTOR_CACHE_CAPACITY } from './sector-cache';
import { galaxyFieldHalfDepth, layerWeights, sectorsAround, sectorWithinReach, selectTier, starFieldReach, starTierTiltScale, tierBlend } from './tier';

// A camera whose larger viewport axis spans `across` light-years.
function camAcross(across: number): ReturnType<typeof makeCamera> {
  const viewportW = 800;
  const viewportH = 600;
  const zoom = Math.max(viewportW, viewportH) / (across * AU_PER_LY);
  return makeCamera({ viewportH, viewportW, x: 0, y: 0, zoom });
}

describe('selectTier', () => {
  const STAR_AT = SYSTEM_TIER_MAX_AU / AU_PER_LY;

  it('selects each tier by zoom (light-years across)', () => {
    // Sample a value comfortably inside each tier's band, derived from the
    // boundary constants so the test tracks any rescale of the spatial model.
    expect(selectTier(camAcross(STAR_AT * 0.4), 'system')).toBe('system');
    expect(selectTier(camAcross(Math.sqrt(STAR_AT * GALAXY_TIER_LY)), 'system')).toBe('star');
    expect(selectTier(camAcross(Math.sqrt(GALAXY_TIER_LY * GALAXY_FIELD_LY)), 'system')).toBe('galaxy');
    expect(selectTier(camAcross(Math.sqrt(GALAXY_FIELD_LY * UNIVERSE_LY)), 'system')).toBe('galaxy-field');
    expect(selectTier(camAcross(UNIVERSE_LY * 2), 'system')).toBe('universe');
  });

  it('holds the previous tier within the hysteresis dead-band at a boundary', () => {
    const nearGalaxy = GALAXY_TIER_LY * 1.1; // just past the star → galaxy edge
    expect(selectTier(camAcross(nearGalaxy), 'star')).toBe('star');
    expect(selectTier(camAcross(nearGalaxy), 'galaxy')).toBe('galaxy');
  });
});

describe('tierBlend', () => {
  const auAcross = (au: number): ReturnType<typeof makeCamera> => camAcross(au / AU_PER_LY);

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
    expect(starTierTiltScale(camAcross(STAR_TILT_EASE_START_LY / 2))).toBe(1);
    expect(starTierTiltScale(camAcross(GALAXY_TIER_LY))).toBe(0);
    const mid = starTierTiltScale(camAcross(Math.sqrt(STAR_TILT_EASE_START_LY * GALAXY_TIER_LY)));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('sectorsAround', () => {
  it('covers the cube around a point, across negative coordinates', () => {
    expect(sectorsAround(0, SECTOR_SIZE * 2.5, -SECTOR_SIZE * 0.5, SECTOR_SIZE)).toEqual({ maxSx: 1, maxSy: 3, maxSz: 0, minSx: -1, minSy: 1, minSz: -2 });
  });
});

describe('star-tier reach', () => {
  it('keeps the widest star-field range inside the sector cache', () => {
    // A range of reach r spans at most (2·ceil(r) + 2)³ sectors; evicting any of
    // them while still in view would regenerate sectors every frame.
    const side = 2 * Math.ceil(STAR_MAX_REACH_LY / LY_PER_SECTOR) + 2;
    expect(side ** 3).toBeLessThan(SECTOR_CACHE_CAPACITY);
  });

  it('depends on the zoom alone, so tilting at a fixed zoom keeps the same stars', () => {
    // `starFieldReach` takes no tilt: a top-down, a 10° and a horizon view at
    // the same zoom all draw the sphere of this radius around the focus.
    const across = 8;
    const expected = Math.min(Math.max((across / 2) * STAR_REACH_SPAN_FACTOR, STAR_MIN_REACH_LY), STAR_MAX_REACH_LY);
    expect(starFieldReach(camAcross(across)) / AU_PER_LY).toBeCloseTo(expected);
    // At least what the widest (horizon) view used to reach: 3× the half-span.
    expect(starFieldReach(camAcross(across)) / AU_PER_LY).toBeGreaterThanOrEqual(Math.min(across / 2 * 3, STAR_MAX_REACH_LY));
  });

  it('clamps to the cross-fade neighbourhood and the sector-cache bound', () => {
    expect(starFieldReach(camAcross(0.01)) / AU_PER_LY).toBeCloseTo(STAR_MIN_REACH_LY);
    expect(starFieldReach(camAcross(1000)) / AU_PER_LY).toBeCloseTo(STAR_MAX_REACH_LY);
  });
});

describe('galaxyFieldHalfDepth', () => {
  it('scans at most two galaxy-cell layers in depth at the widest galaxy-field view', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const halfDepth = galaxyFieldHalfDepth(camAcross(UNIVERSE_LY * TIER_HYSTERESIS));
    for (const focusZ of [0, 0.3 * cell, 0.5 * cell, -0.7 * cell, 12.9 * cell]) {
      const layers = Math.floor((focusZ + halfDepth) / cell) - Math.floor((focusZ - halfDepth) / cell) + 1;
      expect(layers).toBeLessThanOrEqual(2);
    }
  });

  it('stays as deep as the view is wide while the view is narrower than a cell', () => {
    const across = GALAXY_CELL_LY / 4;
    expect(galaxyFieldHalfDepth(camAcross(across)) / AU_PER_LY).toBeCloseTo(across / 2);
  });
});

describe('sectorWithinReach', () => {
  const S = SECTOR_SIZE;

  it('accepts the sector holding the point and rejects one past the radius', () => {
    expect(sectorWithinReach(0, 0, 0, 0.5 * S, 0.5 * S, 0.5 * S, 1)).toBe(true);
    expect(sectorWithinReach(5, 0, 0, 0.5 * S, 0.5 * S, 0.5 * S, 3 * S)).toBe(false);
  });

  it('measures to the sector\'s nearest point, across faces and negative coordinates', () => {
    // The point is 0.25 S below the face of sector (0, 0, 0) on every axis.
    expect(sectorWithinReach(-1, -1, -1, 0.25 * S, 0.25 * S, 0.25 * S, 0)).toBe(false);
    expect(sectorWithinReach(0, 0, 0, -0.25 * S, 0.5 * S, 0.5 * S, 0.25 * S)).toBe(true);
    expect(sectorWithinReach(0, 0, 0, -0.25 * S, 0.5 * S, 0.5 * S, 0.24 * S)).toBe(false);
  });

  it('drops the corner sectors of the cube around a point', () => {
    const r = 3 * S;
    const range = sectorsAround(0.5 * S, 0.5 * S, 0.5 * S, r);
    let inCube = 0;
    let inSphere = 0;
    for (let sz = range.minSz; sz <= range.maxSz; sz++) {
      for (let sy = range.minSy; sy <= range.maxSy; sy++) {
        for (let sx = range.minSx; sx <= range.maxSx; sx++) {
          inCube++;
          if (sectorWithinReach(sx, sy, sz, 0.5 * S, 0.5 * S, 0.5 * S, r))
            inSphere++;
        }
      }
    }
    expect(inSphere).toBeLessThan(inCube * 0.8);
    // The extreme corner is out, the middle of a face is in.
    expect(sectorWithinReach(range.minSx, range.minSy, range.minSz, 0.5 * S, 0.5 * S, 0.5 * S, r)).toBe(false);
    expect(sectorWithinReach(range.minSx, 0, 0, 0.5 * S, 0.5 * S, 0.5 * S, r)).toBe(true);
  });
});
