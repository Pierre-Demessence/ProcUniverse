import { describe, expect, it } from 'vitest';

import { LY_PER_SECTOR, ORBIT_INNER_AU, ORBIT_RATIO_OUTER_MAX, PLANET_MAX } from './config';
import { AU_PER_LY } from './generation/units';
import { SECTOR_SIZE, starVisualRadius } from './scale';

describe('scale', () => {
  it('sizes a sector from the light-years-per-sector knob', () => {
    expect(LY_PER_SECTOR).toBeGreaterThan(0);
    expect(SECTOR_SIZE).toBeCloseTo(LY_PER_SECTOR * AU_PER_LY, 3);
  });

  it('keeps a sector far wider than the planetary systems inside it', () => {
    // Orbits are AU-scale; the sector is the interstellar unit. Even the widest
    // possible system (every orbit drawn at the largest cold/outer ratio) fits
    // with room to spare inside one sector, so the density knob can be retuned
    // without the interstellar gap collapsing below a system's own extent.
    const widestOrbit = ORBIT_INNER_AU * ORBIT_RATIO_OUTER_MAX ** PLANET_MAX;
    expect(SECTOR_SIZE).toBeGreaterThan(widestOrbit * 3);
  });
});

describe('starVisualRadius', () => {
  it('maps a Sun-like radius to a visible AU disc, not its physical ~0.005 AU', () => {
    expect(starVisualRadius(1)).toBeCloseTo(0.16, 6);
    expect(starVisualRadius(1)).toBeGreaterThan(0.05);
  });

  it('grows with physical radius', () => {
    expect(starVisualRadius(10)).toBeGreaterThan(starVisualRadius(1));
    expect(starVisualRadius(1)).toBeGreaterThan(starVisualRadius(0.2));
  });

  it('clamps to a visible, non-overwhelming range', () => {
    expect(starVisualRadius(1e12)).toBe(0.7);
    expect(starVisualRadius(1e-6)).toBe(0.05);
  });
});
