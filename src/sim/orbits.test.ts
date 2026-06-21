import type { OrbitElements } from './orbits';

import { describe, expect, it } from 'vitest';

import { orbitalPeriod, writeOrbitPosition } from './orbits';

function makeOrbit(overrides: Partial<OrbitElements> = {}): OrbitElements {
  return { a: 100, argPeriapsis: 0, cx: 0, cy: 0, e: 0, meanAnomaly0: 0, starMass: 1, ...overrides };
}

function distance(orbit: OrbitElements, t: number): number {
  const out = { x: 0, y: 0 };
  writeOrbitPosition(orbit, t, out);
  return Math.hypot(out.x - orbit.cx, out.y - orbit.cy);
}

function step(orbit: OrbitElements, t: number, dt: number): number {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 0 };
  writeOrbitPosition(orbit, t, p0);
  writeOrbitPosition(orbit, t + dt, p1);
  return Math.hypot(p1.x - p0.x, p1.y - p0.y);
}

describe('orbitalPeriod (Kepler III)', () => {
  it('grows with the semi-major axis as a^1.5', () => {
    expect(orbitalPeriod(1, 200) / orbitalPeriod(1, 100)).toBeCloseTo(2 ** 1.5, 6);
  });

  it('shrinks with host mass as 1/sqrt(M)', () => {
    expect(orbitalPeriod(4, 100) / orbitalPeriod(1, 100)).toBeCloseTo(0.5, 6);
  });

  it('matches sqrt(a³/M) overall', () => {
    const ratio = orbitalPeriod(2, 150) / orbitalPeriod(8, 150);
    expect(ratio).toBeCloseTo(Math.sqrt(8 / 2), 6);
  });
});

describe('writeOrbitPosition', () => {
  it('keeps a circular orbit (e=0) at constant radius from the focus', () => {
    const orbit = makeOrbit({ a: 80, cx: 12, cy: -7, meanAnomaly0: 0.9 });
    const period = orbitalPeriod(orbit.starMass, orbit.a);
    for (let k = 0; k < 8; k++)
      expect(distance(orbit, (period * k) / 8)).toBeCloseTo(80, 6);
  });

  it('returns to the start after exactly one period', () => {
    const orbit = makeOrbit({ a: 120, argPeriapsis: 1.1, e: 0.3, meanAnomaly0: 0.5, starMass: 2 });
    const period = orbitalPeriod(orbit.starMass, orbit.a);
    const start = { x: 0, y: 0 };
    const looped = { x: 0, y: 0 };
    writeOrbitPosition(orbit, 0, start);
    writeOrbitPosition(orbit, period, looped);
    expect(looped.x).toBeCloseTo(start.x, 5);
    expect(looped.y).toBeCloseTo(start.y, 5);
  });

  it('puts periapsis nearer and apoapsis farther than the semi-major axis', () => {
    const orbit = makeOrbit({ a: 100, e: 0.4, meanAnomaly0: 0 });
    const period = orbitalPeriod(orbit.starMass, orbit.a);
    // meanAnomaly0 = 0 starts at periapsis; half a period later is apoapsis.
    expect(distance(orbit, 0)).toBeCloseTo(100 * (1 - 0.4), 4);
    expect(distance(orbit, period / 2)).toBeCloseTo(100 * (1 + 0.4), 4);
  });

  it('moves faster at periapsis than apoapsis (Kepler II)', () => {
    const period = orbitalPeriod(1, 100);
    const dt = period / 2000;
    const atPeriapsis = step(makeOrbit({ a: 100, e: 0.5, meanAnomaly0: 0 }), 0, dt);
    const atApoapsis = step(makeOrbit({ a: 100, e: 0.5, meanAnomaly0: Math.PI }), 0, dt);
    expect(atPeriapsis).toBeGreaterThan(atApoapsis);
  });

  it('spins planets faster around a heavier star at equal a', () => {
    const period = orbitalPeriod(1, 100);
    const dt = period / 2000;
    const light = step(makeOrbit({ a: 100, starMass: 1 }), 0, dt);
    const heavy = step(makeOrbit({ a: 100, starMass: 4 }), 0, dt);
    expect(heavy).toBeGreaterThan(light);
  });
});
