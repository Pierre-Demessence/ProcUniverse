import type { StarData, SystemData } from './universe';

import { describe, expect, it } from 'vitest';

import { SECTOR_SIZE } from '../scale';
import { frostLine } from './planets';
import { AU_PER_LY } from './units';
import { generateSectorData, generateSystem, isSameSystem, samplePoisson } from './universe';

/** The full systems (planets and moons) of every star in a sector. */
function systemsIn(seed: number, sx: number, sy: number, sz: number): SystemData[] {
  return generateSectorData(seed, sx, sy, sz).stars.map(star => generateSystem(seed, star));
}

describe('generateSectorData', () => {
  it('is deterministic for the same seed and coordinates', () => {
    const first = generateSectorData(1337, 0, 0, 0);
    const second = generateSectorData(1337, 0, 0, 0);
    expect(second).toEqual(first);
  });

  it('differs for different sector coordinates', () => {
    const a = generateSectorData(1337, 0, 0, 0);
    const b = generateSectorData(1337, 1, 0, 0);
    const c = generateSectorData(1337, 0, 1, 0);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(a);
    expect(c).not.toEqual(b);
  });

  it('holds star-only records: no planets, and the star physics a system continues from', () => {
    const { stars } = generateSectorData(1337, 0, 0, 0);
    expect(stars.length).toBeGreaterThan(0);
    for (const star of stars) {
      expect(star).not.toHaveProperty('planets');
      expect(star.star.mass).toBeGreaterThan(0);
      expect(star.radius).toBeGreaterThan(0);
    }
  });

  it('differs for different world seeds', () => {
    const a = generateSectorData(1, 0, 0, 0);
    const b = generateSectorData(2, 0, 0, 0);
    expect(b).not.toEqual(a);
  });

  it('produces well-formed systems with outward, bounded-eccentricity orbits', () => {
    const systems = systemsIn(1337, 0, 0, 0);
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
    const systems = systemsIn(1337, 0, 0, 0);
    for (const sys of systems) {
      expect(sys.name.scientific.startsWith(`${sys.star.spectralClass}-`)).toBe(true);
      sys.planets.forEach((p, i) => {
        // Innermost planet is 'b' (98), then 'c', 'd', …, mirroring exoplanet naming.
        expect(p.name.scientific).toBe(`${sys.name.scientific} ${String.fromCharCode(98 + i)}`);
      });
    }
  });

  it('scatters systems through each cubic sector without a fixed lattice', () => {
    const systems = sectorBlock(1337, 3);
    expect(systems.length).toBeGreaterThan(30);
    // Continuous placement: positions are all distinct, each system lies inside
    // its own sector cube, and the in-cube offsets span the cube on every axis
    // rather than snapping to a grid of cell centres.
    const keys = new Set(systems.map(({ sys }) => `${sys.x},${sys.y},${sys.z}`));
    expect(keys.size).toBe(systems.length);
    for (const axis of ['x', 'y', 'z'] as const) {
      const offsets = systems.map(({ sector, sys }) => sys[axis] / SECTOR_SIZE - sector[axis]);
      for (const f of offsets) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(1);
      }
      expect(Math.min(...offsets)).toBeLessThan(0.25);
      expect(Math.max(...offsets)).toBeGreaterThan(0.75);
    }
  });

  it('populates the cold region beyond the frost line and reaches far out', () => {
    // Sample a grid of sectors so the population spans many stars: the wider
    // outer-ratio spacing must actually trigger (cold planets beyond the frost
    // line exist) and let some systems reach well past the inner-only ~8 AU cap.
    let coldPlanets = 0;
    let widest = 0;
    for (const { sys } of sectorBlock(1337, 5)) {
      const frost = frostLine(sys.star.luminosity);
      for (const p of sys.planets) {
        if (p.a >= frost)
          coldPlanets++;
        widest = Math.max(widest, p.a);
      }
    }
    expect(coldPlanets).toBeGreaterThan(0);
    expect(widest).toBeGreaterThan(10);
  });
});

describe('generateSystem', () => {
  const star = (): StarData => generateSectorData(1337, 0, 0, 0).stars[0];

  it('keeps the star record identity and physics, and adds planets and a disk normal', () => {
    const record = star();
    const system = generateSystem(1337, record);
    expect(system).toMatchObject({ name: record.name, activity: record.activity, radius: record.radius, seed: record.seed, x: record.x, y: record.y, z: record.z });
    expect(system.star).toEqual(record.star);
    expect(system.planets.length).toBeGreaterThan(0);
    expect(Math.hypot(...system.diskNormal)).toBeCloseTo(1, 9);
  });

  it('is the same system however often or in whatever order it is generated', () => {
    const records = [0, 1, 2, 3].flatMap(sx => generateSectorData(1337, sx, 0, 0).stars).slice(0, 3);
    expect(records).toHaveLength(3);
    const forward = records.map(r => generateSystem(1337, r));
    const backward = [...records].reverse().map(r => generateSystem(1337, r)).reverse();
    generateSystem(1337, records[2]);
    expect(backward).toEqual(forward);
    expect(generateSystem(1337, records[0])).toEqual(forward[0]);
  });

  it('regenerates pinned systems byte-identically', () => {
    // Fingerprint of the full systems of a few sectors: any change to the
    // star's or its planets' draws, or to their order, shows up here. Update it
    // deliberately.
    const parts: string[] = [];
    for (const [sx, sy, sz] of [[0, 0, 0], [3, -2, 1], [-40, 17, 0], [1000, 5, -2]])
      parts.push(JSON.stringify(systemsIn(12345, sx, sy, sz)));
    expect(fingerprint(parts.join('|'))).toBe('34369dc2-7c5ace91-105446');
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
    for (const sys of systemsIn(1337, 0, 0, 0)) {
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
        for (const sys of systemsIn(1337, sx, sy, 0)) {
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
        for (const sys of systemsIn(1337, sx, sy, 0)) {
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
        for (const sys of systemsIn(1337, sx, sy, 0)) {
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

/** Two FNV-1a 32-bit hashes (different offsets) plus the length: a 64-bit+ content fingerprint. */
function fingerprint(text: string): string {
  let a = 0x811C9DC5;
  let b = 0x01000193 ^ 0x5BD1E995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return `${a.toString(16)}-${b.toString(16)}-${text.length}`;
}

/** Systems in the `side`³ block of sectors from (0, 0, -1), each with its sector coordinates. */
function sectorBlock(seed: number, side: number): { sector: { x: number; y: number; z: number }; sys: SystemData }[] {
  const out: { sector: { x: number; y: number; z: number }; sys: SystemData }[] = [];
  for (let sz = -1; sz < side - 1; sz++) {
    for (let sy = 0; sy < side; sy++) {
      for (let sx = 0; sx < side; sx++) {
        for (const sys of systemsIn(seed, sx, sy, sz))
          out.push({ sector: { x: sx, y: sy, z: sz }, sys });
      }
    }
  }
  return out;
}

/** Total systems in `count` sectors along +x starting at sector `(sx, sy, sz)`. */
function countAlongX(seed: number, sx: number, sy: number, sz: number, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++)
    n += generateSectorData(seed, sx + i, sy, sz).stars.length;
  return n;
}

describe('generateSectorData 3D star placement', () => {
  it('regenerates a pinned universe byte-identically', () => {
    // Fingerprint of a few sectors across the home galaxy: any change to a draw,
    // its order, or the density model shows up here. Update it deliberately.
    const parts: string[] = [];
    for (const [sx, sy, sz] of [[0, 0, 0], [3, -2, 1], [-40, 17, 0], [1000, 5, -2]])
      parts.push(JSON.stringify(generateSectorData(12345, sx, sy, sz)));
    expect(fingerprint(parts.join('|'))).toBe('71988561-cc090a56-11020');
  });

  it('follows the galaxy: dense at the core, sparse in the outer disk, near-empty high above it', () => {
    const lyToSector = AU_PER_LY / SECTOR_SIZE;
    const core = countAlongX(1337, 0, 0, 0, 50);
    const disk = countAlongX(1337, Math.round(25000 * lyToSector), 0, 0, 50);
    const halo = countAlongX(1337, Math.round(25000 * lyToSector), 0, Math.round(8000 * lyToSector), 50);
    expect(core).toBeGreaterThan(disk * 5);
    expect(disk).toBeGreaterThan(halo);
    expect(halo).toBeLessThanOrEqual(2);
  });

  it('places the home galaxy central black hole in the sector holding the origin', () => {
    expect(generateSectorData(1337, 0, 0, 0).blackHoles).toHaveLength(1);
    expect(generateSectorData(1337, 0, 0, -1).blackHoles).toHaveLength(0);
    expect(generateSectorData(1337, -1, 0, 0).blackHoles).toHaveLength(0);
  });
});

describe('samplePoisson', () => {
  const rng = (): (() => number) => {
    let seed = 99;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  };

  it('is 0 for a non-positive mean', () => {
    expect(samplePoisson(0, rng())).toBe(0);
    expect(samplePoisson(-1, rng())).toBe(0);
  });

  it.each([0.3, 4, 80])('matches mean %s on average, with a Poisson spread', (mean) => {
    const draw = rng();
    const n = 4000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const k = samplePoisson(mean, draw);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      sum += k;
      sumSq += k * k;
    }
    const avg = sum / n;
    const variance = sumSq / n - avg * avg;
    expect(avg).toBeCloseTo(mean, mean < 1 ? 1 : 0);
    expect(variance / mean).toBeGreaterThan(0.85);
    expect(variance / mean).toBeLessThan(1.15);
  });
});

describe('isSameSystem', () => {
  const system = (scientific: string, x: number, y: number, z: number): SystemData => ({ name: { human: scientific, scientific }, x, y, z }) as unknown as SystemData;

  it('matches a system to itself and to its regenerated copy', () => {
    const a = systemsIn(1337, 0, 0, 0)[0];
    const b = systemsIn(1337, 0, 0, 0)[0];
    expect(a).not.toBe(b);
    expect(isSameSystem(a, b)).toBe(true);
  });

  it('tells apart two systems that share a catalogue name', () => {
    expect(isSameSystem(system('S-12345', 1, 2, 3), system('S-12345', 1, 2, 4))).toBe(false);
    expect(isSameSystem(system('S-12345', 1, 2, 3), system('S-54321', 1, 2, 3))).toBe(false);
  });
});
