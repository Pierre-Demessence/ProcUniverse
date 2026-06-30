import { describe, expect, it } from 'vitest';

import { formatDistance } from './distance';
import { AU_PER_LY, kmToAu } from './generation/units';

describe('formatDistance', () => {
  it('auto-scales by magnitude in adaptive mode', () => {
    expect(formatDistance(5, 'adaptive')).toBe('5 AU');
    expect(formatDistance(2 * AU_PER_LY, 'adaptive')).toBe('2 ly');
    expect(formatDistance(5000 * AU_PER_LY, 'adaptive')).toBe('5 kly');
  });

  it('shows a fixed unit with its label', () => {
    expect(formatDistance(5, 'au')).toBe('5 AU');
    expect(formatDistance(2 * AU_PER_LY, 'ly')).toBe('2 ly');
    expect(formatDistance(kmToAu(250), 'km')).toBe('250 km');
  });

  it('falls back to scientific notation at the extremes', () => {
    expect(formatDistance(1, 'km')).toBe('1.50e8 km');
    expect(formatDistance(1, 'ly')).toBe('1.58e-5 ly');
  });
});
