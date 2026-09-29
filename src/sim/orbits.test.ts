import type { OrbitElements } from './orbits';

import { EcsWorld } from '@pierre/ecs';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { SECONDS_PER_YEAR } from '../generation/units';
import { apoapsis, insolationSwing, meanOrbitalSpeed, orbitalPeriod, OrbitElementsDef, periapsis, planeToElements, ringSegmentCount, tiltNormal, updateOrbits, writeOrbitPosition } from './orbits';

function makeOrbit(overrides: Partial<OrbitElements> = {}): OrbitElements {
  return { a: 100, argPeriapsis: 0, cx: 0, cy: 0, cz: 0, e: 0, inclination: 0, longitudeAscendingNode: 0, meanAnomaly0: 0, parent: -1, starMass: 1, ...overrides };
}

function distance(orbit: OrbitElements, t: number): number {
  const out = { x: 0, y: 0, z: 0 };
  writeOrbitPosition(orbit, t, out);
  return Math.hypot(out.x - orbit.cx, out.y - orbit.cy);
}

function step(orbit: OrbitElements, t: number, dt: number): number {
  const p0 = { x: 0, y: 0, z: 0 };
  const p1 = { x: 0, y: 0, z: 0 };
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
    const start = { x: 0, y: 0, z: 0 };
    const looped = { x: 0, y: 0, z: 0 };
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

describe('writeOrbitPosition in 3D', () => {
  it('stays in the z=0 plane when inclination is zero', () => {
    const orbit = makeOrbit({ a: 100, argPeriapsis: 0.7, e: 0.3, meanAnomaly0: 1.2 });
    const out = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 6; k++) {
      writeOrbitPosition(orbit, k * 5, out);
      expect(out.z).toBeCloseTo(0, 9);
    }
  });

  it('tilts the orbit out of plane by the inclination, keeping the distance to the focus', () => {
    const flat = makeOrbit({ a: 100, meanAnomaly0: Math.PI / 2 });
    const tilted = makeOrbit({ a: 100, inclination: Math.PI / 6, meanAnomaly0: Math.PI / 2 });
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    writeOrbitPosition(flat, 0, a);
    writeOrbitPosition(tilted, 0, b);
    // Same eccentric anomaly → same distance from the focus, now with a z component.
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(Math.hypot(b.x, b.y, b.z), 6);
    expect(Math.abs(b.z)).toBeGreaterThan(1);
  });

  it('rotates the ascending node about z without changing the distance to the focus', () => {
    const base = makeOrbit({ a: 100, inclination: Math.PI / 6, meanAnomaly0: 0.9 });
    const swung = makeOrbit({ a: 100, inclination: Math.PI / 6, longitudeAscendingNode: Math.PI / 3, meanAnomaly0: 0.9 });
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    writeOrbitPosition(base, 0, a);
    writeOrbitPosition(swung, 0, b);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(Math.hypot(b.x, b.y, b.z), 6);
    // Ω rotates about z, so z is unchanged while x,y differ.
    expect(b.z).toBeCloseTo(a.z, 6);
    expect(Math.abs(b.x - a.x) + Math.abs(b.y - a.y)).toBeGreaterThan(1);
  });
});

describe('ringSegmentCount', () => {
  it('clamps tiny orbits to the minimum and enormous ones to the maximum', () => {
    expect(ringSegmentCount(0)).toBe(64);
    expect(ringSegmentCount(1)).toBe(64);
    expect(ringSegmentCount(1e9)).toBe(1024);
  });

  it('adds segments as the on-screen radius grows, within the bounds', () => {
    const small = ringSegmentCount(500);
    const big = ringSegmentCount(5000);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(64);
    expect(big).toBeLessThanOrEqual(4096);
  });
});

describe('orbital-plane geometry', () => {
  it('reports zero inclination for the +z (flat) normal', () => {
    expect(planeToElements(0, 0, 1).inclination).toBeCloseTo(0, 9);
  });

  it('tilts the +z normal by exactly the given angle', () => {
    const [x, y, z] = tiltNormal(0, 0, 1, Math.PI / 4, 0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(z).toBeCloseTo(Math.cos(Math.PI / 4), 9);
    expect(planeToElements(x, y, z).inclination).toBeCloseTo(Math.PI / 4, 9);
  });

  it('leaves the normal unchanged when the tilt angle is zero', () => {
    const [x, y, z] = tiltNormal(0, 0, 1, 0, 1.3);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(1, 9);
  });
});

describe('orbit derived quantities', () => {
  it('gives periapsis a(1−e) and apoapsis a(1+e)', () => {
    const orbit = makeOrbit({ a: 100, e: 0.4 });
    expect(periapsis(orbit)).toBeCloseTo(60, 6);
    expect(apoapsis(orbit)).toBeCloseTo(140, 6);
  });

  it('matches Earth mean orbital speed ≈ 29.8 km/s', () => {
    expect(meanOrbitalSpeed(makeOrbit({ a: 1, starMass: 1 }))).toBeCloseTo(29.78, 1);
  });

  it('speeds up around a heavier star and slows farther out', () => {
    const earth = meanOrbitalSpeed(makeOrbit({ a: 1, starMass: 1 }));
    expect(meanOrbitalSpeed(makeOrbit({ a: 1, starMass: 4 }))).toBeGreaterThan(earth);
    expect(meanOrbitalSpeed(makeOrbit({ a: 4, starMass: 1 }))).toBeLessThan(earth);
  });

  it('has unit flux swing for a circle and grows with eccentricity', () => {
    expect(insolationSwing(makeOrbit({ e: 0 }))).toBeCloseTo(1, 6);
    expect(insolationSwing(makeOrbit({ e: 0.5 }))).toBeCloseTo(9, 6);
  });
});

describe('updateOrbits with moons', () => {
  it('keeps a moon centred on its planet as the planet moves along its own orbit', () => {
    const world = new EcsWorld();
    world.registerComponent(Position3DDef);
    world.registerComponent(OrbitElementsDef);
    const positions = world.getStore(Position3DDef);
    const orbits = world.getStore(OrbitElementsDef);

    // A planet on a 1 AU circular orbit around a star fixed at the origin.
    const planet = world.createEntity();
    positions.set(planet, { x: 0, y: 0, z: 0 });
    orbits.set(planet, { a: 1, argPeriapsis: 0, cx: 0, cy: 0, cz: 0, e: 0, inclination: 0, longitudeAscendingNode: 0, meanAnomaly0: 0, parent: -1, starMass: 1 });

    // A moon on a tight circular orbit around that planet (parent = planet id),
    // with the planet's mass (solar units) as its central mass.
    const moon = world.createEntity();
    positions.set(moon, { x: 0, y: 0, z: 0 });
    orbits.set(moon, { a: 0.01, argPeriapsis: 0, cx: 0, cy: 0, cz: 0, e: 0, inclination: 0, longitudeAscendingNode: 0, meanAnomaly0: 0, parent: planet, starMass: 3e-6 });

    // A quarter period in: the planet has swept away from its start, so a moon
    // still centred on the origin would be ~1 AU off. Pass 2 must re-focus it.
    updateOrbits(world, 0.25 * SECONDS_PER_YEAR);

    const planetPos = positions.get(planet)!;
    const moonPos = positions.get(moon)!;
    expect(Math.hypot(planetPos.x, planetPos.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(moonPos.x - planetPos.x, moonPos.y - planetPos.y)).toBeCloseTo(0.01, 6);
  });
});
