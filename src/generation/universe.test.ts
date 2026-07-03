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

describe('generateSectorData 3D orbital orientation', () => {
  const DEG = Math.PI / 180;
  function orbitNormal(inclination: number, node: number): [number, number, number] {
    const s = Math.sin(inclination);
    return [s * Math.sin(node), -s * Math.cos(node), Math.cos(inclination)];
  }
  function angleBetween(a: [number, number, number], b: [number, number, number]): number {
    return Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  }

  it('gives every planet a finite inclination in [0, π] and a defined node', () => {
    for (const sys of generateSectorData(1337, 0, 0).systems) {
      for (const p of sys.planets) {
        expect(Number.isFinite(p.inclination)).toBe(true);
        expect(p.inclination).toBeGreaterThanOrEqual(0);
        expect(p.inclination).toBeLessThanOrEqual(Math.PI);
        expect(Number.isFinite(p.longitudeAscendingNode)).toBe(true);
      }
    }
  });

  it('places a planet\'s moons in its equatorial plane — tilted from the orbit by the obliquity', () => {
    let checked = 0;
    for (let sx = 0; sx < 3; sx++) {
      for (let sy = 0; sy < 3; sy++) {
        for (const sys of generateSectorData(1337, sx, sy).systems) {
          for (const p of sys.planets) {
            if (p.moons.length === 0)
              continue;
            const orbitN = orbitNormal(p.inclination, p.longitudeAscendingNode);
            const moonN = orbitNormal(p.moons[0].inclination, p.moons[0].longitudeAscendingNode);
            expect(angleBetween(orbitN, moonN)).toBeCloseTo(p.physical.obliquity * DEG, 5);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('draws obliquity isotropically, so some planets are tipped past 90° (retrograde spin)', () => {
    let past90 = 0;
    let total = 0;
    for (let sx = 0; sx < 3; sx++) {
      for (let sy = 0; sy < 3; sy++) {
        for (const sys of generateSectorData(1337, sx, sy).systems) {
          for (const p of sys.planets) {
            total++;
            if (p.physical.obliquity > 90)
              past90++;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(past90).toBeGreaterThan(0);
  });

  it('tilts eccentric orbits more than near-circular ones (inclination–eccentricity equipartition)', () => {
    // Use each system's least-eccentric planet as a proxy for its disk plane,
    // then compare how far low-e vs high-e planets tilt from it.
    let lowSum = 0;
    let lowN = 0;
    let highSum = 0;
    let highN = 0;
    for (let sx = 0; sx < 4; sx++) {
      for (let sy = 0; sy < 4; sy++) {
        for (const sys of generateSectorData(1337, sx, sy).systems) {
          if (sys.planets.length < 3)
            continue;
          const ref = sys.planets.reduce((m, p) => (p.e < m.e ? p : m));
          const refN = orbitNormal(ref.inclination, ref.longitudeAscendingNode);
          for (const p of sys.planets) {
            if (p === ref)
              continue;
            const tilt = angleBetween(refN, orbitNormal(p.inclination, p.longitudeAscendingNode));
            if (p.e < 0.05) {
              lowSum += tilt;
              lowN++;
            }
            else if (p.e > 0.15) {
              highSum += tilt;
              highN++;
            }
          }
        }
      }
    }
    expect(lowN).toBeGreaterThan(0);
    expect(highN).toBeGreaterThan(0);
    expect(highSum / highN).toBeGreaterThan(lowSum / lowN);
  });
});
