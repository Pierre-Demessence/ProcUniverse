import type { Vec3 } from './plane-basis';

import { describe, expect, it } from 'vitest';

import { blendPlaneNormal, GALACTIC_NORMAL, planeBasis } from './plane-basis';

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
    let prev = planeBasis(blendPlaneNormal(disk, 0)).u;
    for (let t = 0.01; t <= 1.0001; t += 0.01) {
      const { u } = planeBasis(blendPlaneNormal(disk, t));
      expect(dot(u, prev)).toBeGreaterThan(0.99);
      prev = u;
    }
  });
});

describe('blendPlaneNormal', () => {
  it('runs from the disk normal (t = 0) to the galactic normal (t = 1), staying unit length', () => {
    const disk = unit(0.3, -0.5, 0.2);
    const start = blendPlaneNormal(disk, 0);
    for (let i = 0; i < 3; i++)
      expect(start[i]).toBeCloseTo(disk[i], 12);
    const end = blendPlaneNormal(disk, 1);
    expect(end[0]).toBeCloseTo(0, 12);
    expect(end[1]).toBeCloseTo(0, 12);
    expect(end[2]).toBe(1);
    const mid = blendPlaneNormal(disk, 0.5);
    expect(dot(mid, mid)).toBeCloseTo(1, 12);
    // Halfway in angle along the great circle.
    expect(Math.acos(dot(mid, GALACTIC_NORMAL))).toBeCloseTo(Math.acos(disk[2]) / 2, 12);
  });
});
