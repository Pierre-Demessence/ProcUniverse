import { describe, expect, it } from 'vitest';

import { AU_PER_LY } from '../generation/units';
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
});
