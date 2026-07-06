import { describe, expect, it } from 'vitest';

import { pixelToDir } from './starfield';

describe('pixelToDir', () => {
  const W = 2048;
  const H = 1024;

  it('returns a unit vector', () => {
    for (const [px, py] of [[0, 0], [W / 2, H / 2], [W - 1, H - 1], [512, 256], [1536, 768]]) {
      const d = pixelToDir(px, py);
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('maps the centre pixel to forward (+x) at the equator', () => {
    const d = pixelToDir(W / 2, H / 2);
    // azimuth = π, elevation = 0 → (−1, 0, 0) ... wait, let me re-derive.
    // px = W/2 → azimuth = π, cos(π) = −1, sin(π) = 0
    // py = H/2 → elevation = 0, cos(0) = 1, sin(0) = 0
    // dir = (−1, 0, 0) — unit vector, length 1 ✓
    expect(d.x).toBeCloseTo(-1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('maps px = 0 to azimuth 0 (+x)', () => {
    const d = pixelToDir(0, H / 2);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('maps the top row to near the north pole (+z)', () => {
    const d = pixelToDir(0, 0);
    // The pixel centre is slightly below the exact pole.
    expect(d.z).toBeGreaterThan(0.999);
    expect(Math.abs(d.x)).toBeLessThan(0.01);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it('maps the bottom row to near the south pole (−z)', () => {
    const d = pixelToDir(0, H - 1);
    // The pixel centre is slightly above the exact pole; use looser tolerance.
    expect(d.z).toBeLessThan(-0.999);
    expect(Math.abs(d.x)).toBeLessThan(0.01);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it('has consistent azimuth wrapping: px = 0 and px = W give the same direction', () => {
    const a = pixelToDir(0, H / 2);
    const b = pixelToDir(W, H / 2);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });

  it('produces xy-plane directions when at the equator', () => {
    for (let px = 0; px < W; px += W / 8) {
      const d = pixelToDir(px, H / 2);
      expect(d.z).toBeCloseTo(0, 6);
      expect(Math.abs(Math.sqrt(d.x * d.x + d.y * d.y) - 1)).toBeLessThan(1e-6);
    }
  });
});
