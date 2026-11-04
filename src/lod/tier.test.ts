import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { GALAXY_CELL_LY, LY_PER_SECTOR } from '../config/data';
import { CAMERA_FOV_DEG, GALAXY_FIELD_LY, GALAXY_TIER_LY, STAR_BLEND_MAX_AU, STAR_BLEND_MIN_AU, STAR_HANDOFF_START, STAR_MAX_REACH_LY, STAR_MIN_REACH_LY, STAR_REACH_SPAN_FACTOR, SYSTEM_TIER_MAX_AU, TIER_HYSTERESIS, UNIVERSE_LY } from '../config/render';
import { AU_PER_LY } from '../generation/units';
import { SECTOR_SIZE } from '../scale';
import { SECTOR_CACHE_CAPACITY } from './sector-cache';
import { bandBlend, cameraDistance, distanceLy, galaxyFieldHalfDepth, layerWeights, sectorsAround, sectorWithinReach, selectTier, starFieldReach, TIER_BANDS, tierBlend, tierBlends } from './tier';

// A camera whose larger viewport axis spans `across` light-years.
function camAcross(across: number): ReturnType<typeof makeCamera> {
  const viewportW = 800;
  const viewportH = 600;
  const zoom = Math.max(viewportW, viewportH) / (across * AU_PER_LY);
  return makeCamera({ viewportH, viewportW, x: 0, y: 0, zoom });
}

// A camera whose distance from its focus is `ly` light-years.
function camAtDistance(ly: number, viewportW = 800, viewportH = 600): ReturnType<typeof makeCamera> {
  const halfTan = Math.tan((CAMERA_FOV_DEG * Math.PI / 180) / 2);
  const zoom = (viewportH / 2) / halfTan / (ly * AU_PER_LY);
  return makeCamera({ viewportH, viewportW, x: 0, y: 0, zoom });
}

describe('cameraDistance', () => {
  it('puts the camera where the vertical field of view spans viewportH / zoom at the focus', () => {
    const cam = makeCamera({ viewportH: 600, viewportW: 800, x: 0, y: 0, zoom: 12 });
    const halfSpan = cameraDistance(cam) * Math.tan((CAMERA_FOV_DEG * Math.PI / 180) / 2);
    expect(halfSpan * 2 * cam.zoom).toBeCloseTo(600);
  });

  it('does not depend on the viewport width, and converts to light-years', () => {
    const narrow = camAtDistance(5, 400, 600);
    const wide = camAtDistance(5, 1600, 600);
    expect(cameraDistance(narrow)).toBeCloseTo(cameraDistance(wide));
    expect(distanceLy(wide)).toBeCloseTo(5);
  });
});

describe('selectTier', () => {
  const STAR_AT = SYSTEM_TIER_MAX_AU / AU_PER_LY;

  it('selects each tier by camera distance (light-years)', () => {
    // Sample a value comfortably inside each tier's band, derived from the
    // boundary constants so the test tracks any rescale of the spatial model.
    expect(selectTier(camAtDistance(STAR_AT * 0.4), 'system')).toBe('system');
    expect(selectTier(camAtDistance(Math.sqrt(STAR_AT * GALAXY_TIER_LY)), 'system')).toBe('star');
    expect(selectTier(camAtDistance(Math.sqrt(GALAXY_TIER_LY * GALAXY_FIELD_LY)), 'system')).toBe('galaxy');
    expect(selectTier(camAtDistance(Math.sqrt(GALAXY_FIELD_LY * UNIVERSE_LY)), 'system')).toBe('galaxy-field');
    expect(selectTier(camAtDistance(UNIVERSE_LY * 2), 'system')).toBe('universe');
  });

  it('holds the previous tier within the hysteresis dead-band at a boundary', () => {
    const nearGalaxy = GALAXY_TIER_LY * 1.1; // just past the star → galaxy edge
    expect(selectTier(camAtDistance(nearGalaxy), 'star')).toBe('star');
    expect(selectTier(camAtDistance(nearGalaxy), 'galaxy')).toBe('galaxy');
  });

  it('picks the same tier for a portrait and a landscape viewport at one distance', () => {
    const d = Math.sqrt(GALAXY_TIER_LY * GALAXY_FIELD_LY);
    expect(selectTier(camAtDistance(d, 400, 900), 'system')).toBe(selectTier(camAtDistance(d, 1600, 900), 'system'));
  });
});

describe('tier bands', () => {
  const boundaries = [SYSTEM_TIER_MAX_AU / AU_PER_LY, GALAXY_TIER_LY, GALAXY_FIELD_LY, UNIVERSE_LY];

  it('has one band per tier boundary, in → out, each between the tiers it joins', () => {
    expect(TIER_BANDS.map(b => [b.inner, b.outer])).toEqual([
      ['system', 'star'],
      ['star', 'galaxy'],
      ['galaxy', 'galaxy-field'],
      ['galaxy-field', 'universe'],
    ]);
  });

  it('encloses every boundary hysteresis dead-band, so a layer lives wherever it is still visible', () => {
    TIER_BANDS.forEach((band, i) => {
      const b = boundaries[i]!;
      expect(band.minLy).toBeLessThan(b / TIER_HYSTERESIS);
      expect(band.maxLy).toBeGreaterThan(b * TIER_HYSTERESIS);
      const atBoundary = bandBlend(band, b);
      expect(atBoundary).toBeGreaterThan(0);
      expect(atBoundary).toBeLessThan(1);
    });
  });

  it('runs from 0 at the inner edge to 1 at the outer edge and rises monotonically between', () => {
    for (const band of TIER_BANDS) {
      expect(bandBlend(band, band.minLy * 0.5)).toBe(0);
      expect(bandBlend(band, band.maxLy * 2)).toBe(1);
      let prev = 0;
      for (let d = band.minLy; d <= band.maxLy; d *= 1.1) {
        const v = bandBlend(band, d);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('keeps neighbouring bands apart, so at most one cross-fade runs at a time', () => {
    TIER_BANDS.slice(1).forEach((band, i) => {
      expect(band.minLy).toBeGreaterThanOrEqual(TIER_BANDS[i]!.maxLy);
    });
  });

  it('reports every band for the camera distance', () => {
    const blends = tierBlends(camAtDistance(GALAXY_FIELD_LY));
    expect(blends).toHaveLength(TIER_BANDS.length);
    expect(blends[0]).toBe(1);
    expect(blends[1]).toBe(1);
    expect(blends[2]).toBeGreaterThan(0);
    expect(blends[2]).toBeLessThan(1);
    expect(blends[3]).toBe(0);
  });
});

describe('tierBlend', () => {
  const auAt = (au: number): ReturnType<typeof makeCamera> => camAtDistance(au / AU_PER_LY);

  it('is 0 inside the system view, 1 in the star field, and rises monotonically between', () => {
    expect(tierBlend(auAt(STAR_BLEND_MIN_AU * 0.5))).toBe(0);
    expect(tierBlend(auAt(STAR_BLEND_MAX_AU * 2))).toBe(1);
    let prev = 0;
    for (let au = STAR_BLEND_MIN_AU; au <= STAR_BLEND_MAX_AU; au *= 1.1) {
      const b = tierBlend(auAt(au));
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('is the first band, configured in AU', () => {
    expect(TIER_BANDS[0]!.minLy * AU_PER_LY).toBeCloseTo(STAR_BLEND_MIN_AU);
    expect(TIER_BANDS[0]!.maxLy * AU_PER_LY).toBeCloseTo(STAR_BLEND_MAX_AU);
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
