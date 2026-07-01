import { describe, expect, it } from 'vitest';

import { DISK_OUTER_MAX_AU, LY_PER_SECTOR } from './config';
import { AU_PER_LY } from './generation/units';
import { SECTOR_SIZE, starVisualRadius } from './scale';

describe('scale', () => {
  it('sizes a sector from the light-years-per-sector knob', () => {
    expect(LY_PER_SECTOR).toBeGreaterThan(0);
    expect(SECTOR_SIZE).toBeCloseTo(LY_PER_SECTOR * AU_PER_LY, 3);
  });

  it('keeps a sector far wider than the planetary systems inside it', () => {
    // Orbits are AU-scale; the sector is the interstellar unit. A planet-forming
    // disk saturates at DISK_OUTER_MAX_AU, so even the most extended system fits
    // with room to spare inside one sector, and the density knob can be retuned
    // without the interstellar gap collapsing below a system's own extent.
    expect(SECTOR_SIZE).toBeGreaterThan(DISK_OUTER_MAX_AU * 3);
  });
});

describe('starVisualRadius', () => {
  it('returns the true physical radius in AU (the Sun is ~0.005 AU)', () => {
    expect(starVisualRadius(1)).toBeCloseTo(0.00465, 5);
  });

  it('scales linearly with physical radius', () => {
    expect(starVisualRadius(10)).toBeCloseTo(10 * starVisualRadius(1), 10);
    expect(starVisualRadius(10)).toBeGreaterThan(starVisualRadius(1));
    expect(starVisualRadius(1)).toBeGreaterThan(starVisualRadius(0.2));
  });
});
