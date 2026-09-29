import { SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { equirectDirection, planetVarietySeed, VARIETY_SEED_RANGE } from './planet-surface';

const JUPITER = { equilibriumTemp: 110, mass: 317.8, radius: 11.2, rotationPeriod: 9.9 };

describe('planetVarietySeed', () => {
  it('is deterministic', () => {
    expect(planetVarietySeed(JUPITER)).toBe(planetVarietySeed({ ...JUPITER }));
  });

  it('stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const seed = planetVarietySeed({ ...JUPITER, mass: i * 1.7 });
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(VARIETY_SEED_RANGE);
    }
  });

  it('separates near-identical planets', () => {
    const a = planetVarietySeed(JUPITER);
    const b = planetVarietySeed({ ...JUPITER, mass: JUPITER.mass + 1e-9 });
    expect(Math.abs(a - b)).toBeGreaterThan(1);
  });
});

describe('equirectDirection', () => {
  it('matches SphereGeometry vertices at their UVs', () => {
    const geometry = new SphereGeometry(1, 16, 12);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = equirectDirection(uv.getX(i), uv.getY(i));
      expect(x).toBeCloseTo(position.getX(i), 5);
      expect(y).toBeCloseTo(position.getY(i), 5);
      expect(z).toBeCloseTo(position.getZ(i), 5);
    }
    geometry.dispose();
  });

  it('puts v = 1 on the +Y pole', () => {
    expect(equirectDirection(0.3, 1)[1]).toBeCloseTo(1);
    expect(equirectDirection(0.3, 0)[1]).toBeCloseTo(-1);
  });
});
