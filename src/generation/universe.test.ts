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

  it('produces well-formed systems with outward, bounded-eccentricity orbits', () => {
    const { systems } = generateSectorData(1337, 0, 0);
    expect(systems.length).toBeGreaterThan(0);
    for (const sys of systems) {
      expect(sys.radius).toBeGreaterThan(0);
      expect(sys.star.mass).toBeGreaterThan(0);
      expect(sys.planets.length).toBeGreaterThan(0);
      for (let i = 0; i < sys.planets.length; i++) {
        const p = sys.planets[i];
        expect(p.e).toBeGreaterThanOrEqual(0);
        expect(p.e).toBeLessThan(1);
        expect(p.argPeriapsis).toBeGreaterThanOrEqual(0);
        expect(p.meanAnomaly0).toBeGreaterThanOrEqual(0);
        // Orbits are ordered strictly outward.
        if (i > 0)
          expect(p.a).toBeGreaterThan(sys.planets[i - 1].a);
      }
    }
  });

  it('assigns deterministic catalogue names tied to the star class and orbit order', () => {
    const { systems } = generateSectorData(1337, 0, 0);
    for (const sys of systems) {
      expect(sys.name.startsWith(`${sys.star.spectralClass}-`)).toBe(true);
      sys.planets.forEach((p, i) => {
        // Innermost planet is 'b' (98), then 'c', 'd', …, mirroring exoplanet naming.
        expect(p.name).toBe(`${sys.name} ${String.fromCharCode(98 + i)}`);
      });
    }
  });
});
