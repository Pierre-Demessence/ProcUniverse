import { describe, expect, it } from 'vitest';

import { AU_PER_LY, KM_PER_AU } from '../generation/units';
import { formatCoord } from './draw-coords';

describe('formatCoord', () => {
  it('auto-selects AU / ly / kly / Mly by magnitude', () => {
    expect(formatCoord(500)).toBe('500 AU');
    expect(formatCoord(2 * AU_PER_LY)).toBe('2 ly');
    expect(formatCoord(5000 * AU_PER_LY)).toBe('5 kly');
    expect(formatCoord(3e6 * AU_PER_LY)).toBe('3 Mly');
  });

  it('keeps the sign for negative coordinates', () => {
    expect(formatCoord(-2 * AU_PER_LY)).toBe('-2 ly');
  });

  it('shows km for sub-AU distances below 1e6 km', () => {
    const au = 1e5 / KM_PER_AU; // 100,000 km
    expect(formatCoord(au)).toBe('100,000 km');
  });

  it('shows Mkm for sub-AU distances at or above 1e6 km', () => {
    const au = 5e7 / KM_PER_AU; // 50,000,000 km = 50 Mkm
    expect(formatCoord(au)).toBe('50 Mkm');
  });

  it('keeps the sign for negative Mkm coordinates', () => {
    const au = -5e7 / KM_PER_AU; // -50 Mkm
    expect(formatCoord(au)).toBe('-50 Mkm');
  });
});
