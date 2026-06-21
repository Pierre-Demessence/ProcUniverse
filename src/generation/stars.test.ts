import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import {
  luminosityFromMass,
  radiusFromMass,
  sampleStar,
  sampleStellarMass,
  spectralClassFromTemperature,
  temperatureFromLuminosityRadius,
} from './stars';

describe('stellar physics relations', () => {
  it('reproduces the Sun from one solar mass', () => {
    const luminosity = luminosityFromMass(1);
    const radius = radiusFromMass(1);
    const temperature = temperatureFromLuminosityRadius(luminosity, radius);
    expect(luminosity).toBeCloseTo(1, 6);
    expect(radius).toBeCloseTo(1, 6);
    // Sun ≈ 5772 K, a G-class star.
    expect(temperature).toBeGreaterThan(5600);
    expect(temperature).toBeLessThan(5900);
    expect(spectralClassFromTemperature(temperature)).toBe('G');
  });

  it('makes more massive stars hotter and more luminous', () => {
    expect(luminosityFromMass(10)).toBeGreaterThan(luminosityFromMass(1));
    const t10 = temperatureFromLuminosityRadius(luminosityFromMass(10), radiusFromMass(10));
    const t1 = temperatureFromLuminosityRadius(luminosityFromMass(1), radiusFromMass(1));
    expect(t10).toBeGreaterThan(t1);
  });

  it('bins temperature into the right spectral class at the boundaries', () => {
    expect(spectralClassFromTemperature(40000)).toBe('O');
    expect(spectralClassFromTemperature(20000)).toBe('B');
    expect(spectralClassFromTemperature(8000)).toBe('A');
    expect(spectralClassFromTemperature(6500)).toBe('F');
    expect(spectralClassFromTemperature(5772)).toBe('G');
    expect(spectralClassFromTemperature(4500)).toBe('K');
    expect(spectralClassFromTemperature(3000)).toBe('M');
  });
});

describe('initial mass function sampler', () => {
  it('keeps every sampled mass within the clamped range', () => {
    const rng = makeSeededRng(2024);
    for (let i = 0; i < 1000; i++) {
      const mass = sampleStellarMass(rng);
      expect(mass).toBeGreaterThanOrEqual(0.08);
      expect(mass).toBeLessThanOrEqual(50);
    }
  });

  it('produces an M-dwarf-heavy population (Kroupa IMF)', () => {
    const rng = makeSeededRng(7);
    const masses: number[] = [];
    for (let i = 0; i < 5000; i++)
      masses.push(sampleStellarMass(rng));

    const dwarfFraction = masses.filter(m => m < 0.45).length / masses.length;
    expect(dwarfFraction).toBeGreaterThan(0.6);

    masses.sort((a, b) => a - b);
    const median = masses[Math.floor(masses.length / 2)];
    expect(median).toBeLessThan(0.5);
  });
});

describe('sampleStar', () => {
  it('is deterministic for the same rng stream', () => {
    const a = sampleStar(makeSeededRng(99));
    const b = sampleStar(makeSeededRng(99));
    expect(a).toEqual(b);
  });

  it('consumes exactly one rng draw (preserves downstream determinism)', () => {
    const withStar = makeSeededRng(123);
    sampleStar(withStar);
    const afterStar = withStar();

    const direct = makeSeededRng(123);
    direct(); // the single mass draw sampleStar makes
    expect(afterStar).toBe(direct());
  });

  it('derives a self-consistent, well-formed star', () => {
    const star = sampleStar(makeSeededRng(2026));
    expect(star.mass).toBeGreaterThanOrEqual(0.08);
    expect(star.luminosity).toBeGreaterThan(0);
    expect(star.radius).toBeGreaterThan(0);
    expect(star.temperature).toBeGreaterThan(0);
    expect(star.lifetime).toBeGreaterThan(0);
    expect(star.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(['O', 'B', 'A', 'F', 'G', 'K', 'M']).toContain(star.spectralClass);
  });
});
