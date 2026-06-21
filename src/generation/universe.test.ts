import { describe, expect, it } from 'vitest';

import { generateSectorData } from './universe';

describe('generateSectorData', () => {
  it('is deterministic for the same seed and coordinates', () => {
    const first = generateSectorData(1337, 0, 0);
    const second = generateSectorData(1337, 0, 0);
    expect(second).toEqual(first);
  });

  it('differs for different sector coordinates', () => {
    const a = generateSectorData(1337, 0, 0);
    const b = generateSectorData(1337, 1, 0);
    const c = generateSectorData(1337, 0, 1);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(a);
    expect(c).not.toEqual(b);
  });

  it('differs for different world seeds', () => {
    const a = generateSectorData(1, 0, 0);
    const b = generateSectorData(2, 0, 0);
    expect(b).not.toEqual(a);
  });

  it('produces well-formed systems and Keplerian (outward-slowing) orbits', () => {
    const { systems } = generateSectorData(1337, 0, 0);
    expect(systems.length).toBeGreaterThan(0);
    for (const sys of systems) {
      expect(sys.radius).toBeGreaterThan(0);
      expect(sys.planets.length).toBeGreaterThan(0);
      for (let i = 1; i < sys.planets.length; i++) {
        // Orbits are ordered outward, and a larger radius means a slower sweep.
        expect(sys.planets[i].a).toBeGreaterThan(sys.planets[i - 1].a);
        expect(sys.planets[i].omega).toBeLessThan(sys.planets[i - 1].omega);
      }
    }
  });
});
