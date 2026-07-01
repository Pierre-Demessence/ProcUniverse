import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import { hashMoon } from './hash';
import { generateMoons, sampleMoon } from './moons';
import { nameMoon } from './naming';

// A Jupiter-like planet: a wide Hill sphere so several major moons fit. Radius is
// the true physical radius in AU (~11.2 R⊕), mass in solar units (~318 M⊕).
const GIANT_RADIUS_AU = 4.77e-4;
const GIANT_SEMI_MAJOR_AU = 5.2;
const GIANT_MASS_SOLAR = 9.55e-4;
const STAR_MASS_SOLAR = 1;

function hillRadius(semiMajorAu: number, planetMassSolar: number, starMassSolar: number): number {
  return semiMajorAu * Math.cbrt(planetMassSolar / (3 * starMassSolar));
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
    const args = ['P b', GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_SOLAR, STAR_MASS_SOLAR, 6] as const;
    expect(generateMoons(makeSeededRng(7), ...args)).toEqual(generateMoons(makeSeededRng(7), ...args));
  });

  it('places moons on strictly outward orbits within the Hill sphere, named in order', () => {
    const moons = generateMoons(makeSeededRng(7), 'P b', GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_SOLAR, STAR_MASS_SOLAR, 6);
    const hillCap = hillRadius(GIANT_SEMI_MAJOR_AU, GIANT_MASS_SOLAR, STAR_MASS_SOLAR) * 0.4;
    expect(moons.length).toBeGreaterThan(0);
    for (let i = 0; i < moons.length; i++) {
      const moon = moons[i];
      expect(moon.a).toBeGreaterThan(GIANT_RADIUS_AU);
      expect(moon.a).toBeLessThanOrEqual(hillCap);
      expect(moon.e).toBeGreaterThanOrEqual(0);
      expect(moon.e).toBeLessThanOrEqual(0.05);
      expect(moon.name).toBe(nameMoon('P b', i));
      if (i > 0)
        expect(moon.a).toBeGreaterThan(moons[i - 1].a);
    }
  });

  it('returns no moons for a zero count', () => {
    expect(generateMoons(makeSeededRng(1), 'P b', GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_SOLAR, STAR_MASS_SOLAR, 0)).toEqual([]);
  });

  it('holds fewer moons than drawn when the Hill sphere is too tight', () => {
    // A close-in Earth-mass planet has a tiny Hill sphere, so most of the drawn
    // moons fall outside it and are dropped rather than placed unbound.
    const moons = generateMoons(makeSeededRng(3), 'P b', 4.26e-5, 0.05, 3e-6, STAR_MASS_SOLAR, 10);
    expect(moons.length).toBeLessThan(10);
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
    generateMoons(makeSeededRng(hashMoon(999, 0)), 'P b', GIANT_RADIUS_AU, GIANT_SEMI_MAJOR_AU, GIANT_MASS_SOLAR, STAR_MASS_SOLAR, 6);
    const afterMoons = systemRng();

    const controlRng = makeSeededRng(999);
    controlRng();
    const withoutMoons = controlRng();

    expect(afterMoons).toBe(withoutMoons);
  });
});
