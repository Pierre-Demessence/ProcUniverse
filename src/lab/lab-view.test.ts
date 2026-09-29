import { describe, expect, it } from 'vitest';

import { spiralSectors } from './lab-planets';
import { distanceForDiameter } from './lab-view';

describe('distanceForDiameter', () => {
  it('round-trips through the silhouette angle', () => {
    const fov = 50;
    const viewport = 900;
    for (const px of [16, 48, 150, 600]) {
      const d = distanceForDiameter(1, px, viewport, fov);
      const halfAngle = Math.asin(1 / d);
      const projected = (Math.tan(halfAngle) / Math.tan((fov * Math.PI) / 360)) * viewport;
      expect(projected).toBeCloseTo(px, 6);
    }
  });

  it('moves further away for smaller targets', () => {
    expect(distanceForDiameter(1, 16, 900, 50)).toBeGreaterThan(distanceForDiameter(1, 150, 900, 50));
  });
});

describe('spiralSectors', () => {
  it('visits every sector of the square exactly once, nearest ring first', () => {
    const seen = [...spiralSectors(3)];
    expect(seen).toHaveLength(49);
    expect(new Set(seen.map(([x, y]) => `${x},${y}`)).size).toBe(49);
    expect(seen[0]).toEqual([0, 0]);
    const rings = seen.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)));
    expect(rings).toEqual([...rings].sort((a, b) => a - b));
  });
});
