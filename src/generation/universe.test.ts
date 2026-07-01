import { describe, expect, it } from 'vitest';

import { SECTOR_SIZE } from '../scale';
import { frostLine } from './planets';
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
      expect(sys.name.scientific.startsWith(`${sys.star.spectralClass}-`)).toBe(true);
      sys.planets.forEach((p, i) => {
        // Innermost planet is 'b' (98), then 'c', 'd', …, mirroring exoplanet naming.
        expect(p.name.scientific).toBe(`${sys.name.scientific} ${String.fromCharCode(98 + i)}`);
      });
    }
  });

  it('scatters systems across the sector without a fixed lattice', () => {
    const { systems } = generateSectorData(1337, 0, 0);
    expect(systems.length).toBeGreaterThan(10);
    // Continuous placement: positions are all distinct and span the sector,
    // rather than being snapped to a grid of cell centres.
    const keys = new Set(systems.map(s => `${s.x},${s.y}`));
    expect(keys.size).toBe(systems.length);
    const xs = systems.map(s => s.x);
    expect(Math.min(...xs)).toBeLessThan(SECTOR_SIZE * 0.25);
    expect(Math.max(...xs)).toBeGreaterThan(SECTOR_SIZE * 0.75);
  });

  it('populates the cold region beyond the frost line and reaches far out', () => {
    // Sample a grid of sectors so the population spans many stars: the wider
    // outer-ratio spacing must actually trigger (cold planets beyond the frost
    // line exist) and let some systems reach well past the inner-only ~8 AU cap.
    let coldPlanets = 0;
    let widest = 0;
    for (let sx = 0; sx < 3; sx++) {
      for (let sy = 0; sy < 3; sy++) {
        for (const sys of generateSectorData(1337, sx, sy).systems) {
          const frost = frostLine(sys.star.luminosity);
          for (const p of sys.planets) {
            if (p.a >= frost)
              coldPlanets++;
            widest = Math.max(widest, p.a);
          }
        }
      }
    }
    expect(coldPlanets).toBeGreaterThan(0);
    expect(widest).toBeGreaterThan(10);
  });
});
