import type { GeneratedName } from './naming';

import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import { hashMoon } from './hash';
import { generateMoons, sampleMoon } from './moons';
import { nameMoon } from './naming';
import { EARTH_MASS_SOLAR } from './units';

// A Jupiter-like planet: a wide Hill sphere so several major moons fit. Radius is
// the true physical radius in AU (~11.2 R⊕); mass in Earth masses (~318 M⊕).
const GIANT_RADIUS_AU = 4.77e-4;
const GIANT_SEMI_MAJOR_AU = 5.2;
const GIANT_MASS_EARTH = 318;
// An Earth-like world (1 R⊕) for the mass-dependence comparison.
const EARTH_RADIUS_AU = 4.26e-5;
const STAR_MASS_SOLAR = 1;
const P_TEST: GeneratedName = { human: 'P b', scientific: 'P b' };

function hillRadius(semiMajorAu: number, planetMassEarth: number, starMassSolar: number): number {
  return semiMajorAu * Math.cbrt((planetMassEarth * EARTH_MASS_SOLAR) / (3 * starMassSolar));
}

describe('hashMoon', () => {
  it('is deterministic and varies with the system seed and planet index', () => {
    expect(hashMoon(123, 0)).toBe(hashMoon(123, 0));
    expect(hashMoon(123, 0)).not.toBe(hashMoon(123, 1));
    expect(hashMoon(123, 0)).not.toBe(hashMoon(124, 0));
  });

  it('folds any input into a uint32', () => {
    const h = hashMoon(0xFFFFFFFF, 9);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('sampleMoon', () => {
  it('is deterministic for a given rng seed', () => {
    expect(sampleMoon(makeSeededRng(42))).toEqual(sampleMoon(makeSeededRng(42)));
  });

  it('produces a small icy/rocky body with positive radius and density', () => {
    for (let seed = 0; seed < 50; seed++) {
      const moon = sampleMoon(makeSeededRng(seed));
      expect(moon.mass).toBeGreaterThanOrEqual(1e-4);
      expect(moon.mass).toBeLessThanOrEqual(0.05);
      expect(moon.radius).toBeGreaterThan(0);
      expect(moon.density).toBeGreaterThan(0);
      expect(typeof moon.tidallyLocked).toBe('boolean');
    }
  });
});

describe('generateMoons', () => {
  it('is deterministic for a given rng seed', () => {
    const args = [P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 0.8] as const;
    expect(generateMoons(makeSeededRng(7), ...args)).toEqual(generateMoons(makeSeededRng(7), ...args));
  });

  it('places moons on strictly outward orbits within the regular Hill band, named in order', () => {
    const moons = generateMoons(makeSeededRng(7), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 0.9);
    const bandOuter = hillRadius(GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR) * 0.15;
    expect(moons.length).toBeGreaterThan(0);
    for (let i = 0; i < moons.length; i++) {
      const moon = moons[i];
      expect(moon.a).toBeGreaterThan(GIANT_RADIUS_AU);
      expect(moon.a).toBeLessThanOrEqual(bandOuter);
      expect(moon.e).toBeGreaterThanOrEqual(0);
      expect(moon.e).toBeLessThanOrEqual(0.05);
      expect(moon.name).toEqual(nameMoon(P_TEST, i));
      if (i > 0)
        expect(moon.a).toBeGreaterThan(moons[i - 1].a);
    }
  });

  it('holds no moons around a tiny close-in world (Hill sphere too small)', () => {
    // A close-in Earth-mass planet's Hill sphere barely clears its Roche limit,
    // so no orbital slot fits inside the regular band.
    expect(generateMoons(makeSeededRng(3), P_TEST, EARTH_RADIUS_AU, 0.05, 1, STAR_MASS_SOLAR, 0.9)).toEqual([]);
  });

  it('gives a massive giant more moons than a small rocky world', () => {
    let giantTotal = 0;
    let rockyTotal = 0;
    for (let seed = 0; seed < 200; seed++) {
      giantTotal += generateMoons(makeSeededRng(seed), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 0.6).length;
      rockyTotal += generateMoons(makeSeededRng(seed), P_TEST, EARTH_RADIUS_AU, 1, 1, STAR_MASS_SOLAR, 0.6).length;
    }
    expect(giantTotal).toBeGreaterThan(rockyTotal);
  });

  it('gives richer planets more moons on average', () => {
    let richTotal = 0;
    let poorTotal = 0;
    for (let seed = 0; seed < 200; seed++) {
      richTotal += generateMoons(makeSeededRng(seed), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 1).length;
      poorTotal += generateMoons(makeSeededRng(seed), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 0).length;
    }
    expect(richTotal).toBeGreaterThan(poorTotal);
  });

  it('averages a realistic major-moon count for a Sun-like giant', () => {
    const samples = 500;
    let total = 0;
    for (let seed = 0; seed < samples; seed++) {
      // Draw richness like real generation (samplePlanet's per-planet trait).
      const richness = makeSeededRng(seed + 9000)();
      total += generateMoons(makeSeededRng(seed), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, richness).length;
    }
    const mean = total / samples;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(12);
  });
});

describe('moon generation independence (determinism)', () => {
  it('draws only from its own rng, leaving the planet stream byte-identical', () => {
    // A planet's fields come from the system rng; its moons come from a separate
    // hashMoon-seeded rng. Invoking generateMoons must not advance the system
    // stream, so the next planet's draws are unchanged whether or not the planet
    // has moons — the property that keeps the star/planet layout stable.
    const systemRng = makeSeededRng(999);
    systemRng();
    generateMoons(makeSeededRng(hashMoon(999, 0)), P_TEST, GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_EARTH, STAR_MASS_SOLAR, 0.8);
    const afterMoons = systemRng();

    const controlRng = makeSeededRng(999);
    controlRng();
    const withoutMoons = controlRng();

    expect(afterMoons).toBe(withoutMoons);
  });
});
