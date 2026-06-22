import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import {
  bolometricMagnitude,
  escapeVelocity,
  luminosityFromMass,
  meanDensity,
  peakWavelength,
  radiusFromMass,
  sampleStar,
  sampleStellarMass,
  spectralClassFromTemperature,
  surfaceGravityLog,
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

  it('consumes exactly three rng draws (mass, age, metallicity)', () => {
    const withStar = makeSeededRng(123);
    sampleStar(withStar);
    const afterStar = withStar();

    const direct = makeSeededRng(123);
    direct(); // mass
    direct(); // age
    direct(); // metallicity
    expect(afterStar).toBe(direct());
  });

  it('derives a self-consistent, well-formed star', () => {
    const star = sampleStar(makeSeededRng(2026));
    expect(star.mass).toBeGreaterThanOrEqual(0.08);
    expect(star.luminosity).toBeGreaterThan(0);
    expect(star.radius).toBeGreaterThan(0);
    expect(star.temperature).toBeGreaterThan(0);
    expect(star.lifetime).toBeGreaterThan(0);
    expect(star.age).toBeGreaterThanOrEqual(0);
    expect(star.age).toBeLessThanOrEqual(star.lifetime);
    expect(star.metallicity).toBeGreaterThanOrEqual(-1.5);
    expect(star.metallicity).toBeLessThanOrEqual(0.5);
    expect(star.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(['O', 'B', 'A', 'F', 'G', 'K', 'M']).toContain(star.spectralClass);
  });

  it('caps stellar age at the age of the universe, not the longer M-dwarf lifetime', () => {
    // M dwarfs live 1e12-1e13 yr, but the universe is only ~13.8 Gyr old.
    const rng = makeSeededRng(7);
    let maxLongLivedAge = 0;
    for (let i = 0; i < 3000; i++) {
      const star = sampleStar(rng);
      if (star.lifetime > 14e9)
        maxLongLivedAge = Math.max(maxLongLivedAge, star.age);
    }
    expect(maxLongLivedAge).toBeGreaterThan(0);
    expect(maxLongLivedAge).toBeLessThanOrEqual(13.8e9);
  });

  it('samples metallicity around solar with a modest spread', () => {
    const rng = makeSeededRng(11);
    const values: number[] = [];
    for (let i = 0; i < 3000; i++)
      values.push(sampleStar(rng).metallicity);
    const mean = values.reduce((sum, m) => sum + m, 0) / values.length;
    expect(mean).toBeGreaterThan(-0.3);
    expect(mean).toBeLessThan(0.1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1.5);
    expect(Math.max(...values)).toBeLessThanOrEqual(0.5);
  });
});

describe('stellar derived quantities', () => {
  it('anchors the Sun: log g 4.44, ρ 1.41, v_esc 617.5', () => {
    expect(surfaceGravityLog(1, 1)).toBeCloseTo(4.438, 6);
    expect(meanDensity(1, 1)).toBeCloseTo(1.408, 6);
    expect(escapeVelocity(1, 1)).toBeCloseTo(617.5, 6);
  });

  it('scales surface gravity, density, and escape velocity with M and R', () => {
    // A compact, massive star has higher gravity, density, and escape velocity.
    expect(surfaceGravityLog(2, 0.5)).toBeGreaterThan(surfaceGravityLog(1, 1));
    expect(meanDensity(2, 0.5)).toBeGreaterThan(meanDensity(1, 1));
    expect(escapeVelocity(4, 1)).toBeCloseTo(2 * 617.5, 6);
  });

  it('gives M_bol 4.74 for the Sun and brightens (more negative) with L', () => {
    expect(bolometricMagnitude(1)).toBeCloseTo(4.74, 6);
    expect(bolometricMagnitude(100)).toBeCloseTo(-0.26, 6);
  });

  it('places the Sun Wien peak near 502 nm and shifts blue when hotter', () => {
    expect(peakWavelength(5772)).toBeCloseTo(502, 0);
    expect(peakWavelength(11544)).toBeLessThan(peakWavelength(5772));
  });
});
