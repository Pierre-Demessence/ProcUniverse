import type { Vec3 } from './plane-basis';

import { describe, expect, it } from 'vitest';

import { blendPlaneNormal, easePlaneNormal, GALACTIC_NORMAL, planeBasis, referencePlaneNormal } from './plane-basis';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

describe('planeBasis', () => {
  it('uses the fixed galactic basis for the galactic plane', () => {
    const { n, u, v } = planeBasis(GALACTIC_NORMAL);
    expect(n).toEqual([0, 0, 1]);
    expect(u[0]).toBeCloseTo(0);
    expect(u[1]).toBeCloseTo(-1);
    expect(v[0]).toBeCloseTo(1);
    expect(v[1]).toBeCloseTo(0);
  });

  it.each([
    { normal: unit(0.3, -0.5, 0.8) },
    { normal: unit(1, 0, 0) },
    { normal: unit(-0.2, 0.1, -0.97) },
    { normal: [0, 0, -1] as Vec3 },
  ])('returns a right-handed orthonormal basis whose normal is N ($normal)', ({ normal }) => {
    const { n, u, v } = planeBasis(normal);
    for (let i = 0; i < 3; i++)
      expect(n[i]).toBeCloseTo(normal[i], 12);
    expect(dot(u, u)).toBeCloseTo(1, 12);
    expect(dot(v, v)).toBeCloseTo(1, 12);
    expect(dot(u, v)).toBeCloseTo(0, 12);
    expect(dot(u, n)).toBeCloseTo(0, 12);
    // v = N × u
    expect(n[1] * u[2] - n[2] * u[1]).toBeCloseTo(v[0], 12);
    expect(n[2] * u[0] - n[0] * u[2]).toBeCloseTo(v[1], 12);
    expect(n[0] * u[1] - n[1] * u[0]).toBeCloseTo(v[2], 12);
  });

  it('turns smoothly with the normal (no azimuth snap as it reaches the galactic plane)', () => {
    const disk = unit(0.6, 0.2, 0.3);
    let prev = planeBasis(blendPlaneNormal(disk, GALACTIC_NORMAL, 0)).u;
    for (let t = 0.01; t <= 1.0001; t += 0.01) {
      const { u } = planeBasis(blendPlaneNormal(disk, GALACTIC_NORMAL, t));
      expect(dot(u, prev)).toBeGreaterThan(0.99);
      prev = u;
    }
  });
});

describe('blendPlaneNormal', () => {
  it('runs from the first normal (t = 0) to the second (t = 1), staying unit length', () => {
    const disk = unit(0.3, -0.5, 0.2);
    const start = blendPlaneNormal(disk, GALACTIC_NORMAL, 0);
    for (let i = 0; i < 3; i++)
      expect(start[i]).toBeCloseTo(disk[i], 12);
    const end = blendPlaneNormal(disk, GALACTIC_NORMAL, 1);
    expect(end).toEqual([0, 0, 1]);
    const mid = blendPlaneNormal(disk, GALACTIC_NORMAL, 0.5);
    expect(dot(mid, mid)).toBeCloseTo(1, 12);
    // Halfway in angle along the great circle.
    expect(Math.acos(dot(mid, GALACTIC_NORMAL))).toBeCloseTo(Math.acos(disk[2]) / 2, 12);
  });

  it('swings between any two normals along the great circle, in equal angle steps', () => {
    const a = unit(1, 2, -0.5);
    const b = unit(-0.4, 0.3, 0.9);
    const total = Math.acos(dot(a, b));
    for (const t of [0.1, 0.25, 0.5, 0.9]) {
      const n = blendPlaneNormal(a, b, t);
      expect(dot(n, n)).toBeCloseTo(1, 12);
      expect(Math.acos(dot(a, n))).toBeCloseTo(t * total, 10);
      expect(Math.acos(dot(n, b))).toBeCloseTo((1 - t) * total, 10);
    }
  });

  it('clamps t to [0, 1] and returns the start for identical normals', () => {
    const a = unit(0.2, 0.1, 0.9);
    expect(blendPlaneNormal(a, GALACTIC_NORMAL, -3)).toEqual(a);
    expect(blendPlaneNormal(a, GALACTIC_NORMAL, 7)).toEqual(GALACTIC_NORMAL);
    const same = blendPlaneNormal(a, a, 0.5);
    for (let i = 0; i < 3; i++)
      expect(same[i]).toBeCloseTo(a[i], 12);
  });

  it('passes through a perpendicular for exactly opposite normals, keeping unit length', () => {
    const mid = blendPlaneNormal([0, 0, 1], [0, 0, -1], 0.5);
    expect(dot(mid, mid)).toBeCloseTo(1, 12);
    expect(dot(mid, GALACTIC_NORMAL)).toBeCloseTo(0, 12);
  });
});

describe('referencePlaneNormal', () => {
  const disk = unit(0.6, 0.2, 0.3);
  const host = unit(-0.3, 0.5, 0.8);

  it('is the focused disk inside a system, the host plane in a galaxy, and +z at the universe', () => {
    const inSystem = referencePlaneNormal(disk, host, 0, 0);
    for (let i = 0; i < 3; i++)
      expect(inSystem[i]).toBeCloseTo(disk[i], 12);
    const inGalaxy = referencePlaneNormal(disk, host, 1, 0);
    for (let i = 0; i < 3; i++)
      expect(inGalaxy[i]).toBeCloseTo(host[i], 12);
    expect(referencePlaneNormal(disk, host, 1, 1)).toEqual(GALACTIC_NORMAL);
  });

  it('uses the host plane throughout when no system is focused', () => {
    const n = referencePlaneNormal(null, host, 0, 0);
    for (let i = 0; i < 3; i++)
      expect(n[i]).toBeCloseTo(host[i], 12);
  });

  it('moves continuously across both bands, with no snap at either end', () => {
    let prev = referencePlaneNormal(disk, host, 0, 0);
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const n = referencePlaneNormal(disk, host, t, 0);
      expect(dot(n, prev)).toBeGreaterThan(0.99);
      prev = n;
    }
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const n = referencePlaneNormal(disk, host, 1, t);
      expect(dot(n, prev)).toBeGreaterThan(0.99);
      prev = n;
    }
  });
});

describe('easePlaneNormal', () => {
  it('covers the expected fraction of the remaining angle, independent of the step size', () => {
    const from = unit(1, 0, 0);
    const to = GALACTIC_NORMAL;
    const total = Math.acos(dot(from, to));
    const once = easePlaneNormal(from, to, 100, 250);
    expect(Math.acos(dot(once, to))).toBeCloseTo(total * Math.exp(-100 / 250), 10);
    // Two 50 ms steps land where one 100 ms step does.
    const twice = easePlaneNormal(easePlaneNormal(from, to, 50, 250), to, 50, 250);
    for (let i = 0; i < 3; i++)
      expect(twice[i]).toBeCloseTo(once[i], 10);
  });

  it('stays put for a zero step and arrives for a long one', () => {
    const from = unit(1, 1, 0);
    expect(easePlaneNormal(from, GALACTIC_NORMAL, 0, 250)).toEqual(from);
    const done = easePlaneNormal(from, GALACTIC_NORMAL, 1e6, 250);
    expect(dot(done, GALACTIC_NORMAL)).toBeCloseTo(1, 10);
  });
});
