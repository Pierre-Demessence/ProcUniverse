import type { SkySample } from './sky-structure';

import { describe, expect, it } from 'vitest';

import { bakeSkyStructure, dirToUv, pixelToDir, sampleSkyMap, skyStructure } from './sky-structure';

describe('pixelToDir', () => {
  const W = 2048;
  const H = 1024;

  it('returns a unit vector', () => {
    for (const [px, py] of [[0, 0], [W / 2, H / 2], [W - 1, H - 1], [512, 256], [1536, 768]]) {
      const d = pixelToDir(px, py, W, H);
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('maps the centre pixel to backward (−x) at the equator', () => {
    const d = pixelToDir(W / 2, H / 2, W, H);
    // px = W/2 → azimuth = π, cos(π) = −1, sin(π) = 0
    // py = H/2 → elevation = 0, cos(0) = 1, sin(0) = 0
    // dir = (−1, 0, 0) — unit vector, length 1 ✓
    expect(d.x).toBeCloseTo(-1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('maps px = 0 to azimuth 0 (+x)', () => {
    const d = pixelToDir(0, H / 2, W, H);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('maps the top row to near the north pole (+z)', () => {
    const d = pixelToDir(0, 0, W, H);
    // The pixel centre is slightly below the exact pole.
    expect(d.z).toBeGreaterThan(0.999);
    expect(Math.abs(d.x)).toBeLessThan(0.01);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it('maps the bottom row to near the south pole (−z)', () => {
    const d = pixelToDir(0, H - 1, W, H);
    // The pixel centre is slightly above the exact pole; use looser tolerance.
    expect(d.z).toBeLessThan(-0.999);
    expect(Math.abs(d.x)).toBeLessThan(0.01);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it('has consistent azimuth wrapping: px = 0 and px = W give the same direction', () => {
    const a = pixelToDir(0, H / 2, W, H);
    const b = pixelToDir(W, H / 2, W, H);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });

  it('produces xy-plane directions when at the equator', () => {
    for (let px = 0; px < W; px += W / 8) {
      const d = pixelToDir(px, H / 2, W, H);
      expect(d.z).toBeCloseTo(0, 6);
      expect(Math.abs(Math.sqrt(d.x * d.x + d.y * d.y) - 1)).toBeLessThan(1e-6);
    }
  });
});

describe('dirToUv', () => {
  it('inverts pixelToDir', () => {
    const W = 512;
    const H = 256;
    for (const [px, py] of [[10.5, 20.5], [255.5, 128.5], [400.5, 60.5], [0.5, 200.5]] as const) {
      const d = pixelToDir(px, py, W, H);
      const { u, v } = dirToUv(d.x, d.y, d.z);
      expect(u * W).toBeCloseTo(px, 6);
      expect(v * H).toBeCloseTo(py, 6);
    }
  });
});

describe('skyStructure', () => {
  const ctx = { coreX: 1, coreY: 0, seed: 1234 };
  const unit = (x: number, y: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };

  it('is deterministic and keeps every channel in [0, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const [x, y, z] = unit(Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.37) * 0.6);
      const a = skyStructure(x, y, z, ctx);
      expect(skyStructure(x, y, z, ctx)).toEqual(a);
      for (const v of [a.cloud, a.disk, a.dust, a.bulge]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('concentrates the band on the plane', () => {
    expect(skyStructure(0, 1, 0, ctx).disk).toBeGreaterThan(0.5);
    expect(skyStructure(...unit(0, 1, 2), ctx).disk).toBeLessThan(0.01);
    expect(skyStructure(0, 0, 1, ctx).disk).toBeLessThan(0.001);
  });

  it('peaks the bulge toward the core', () => {
    expect(skyStructure(1, 0, 0, ctx).bulge).toBeGreaterThan(0.5);
    expect(skyStructure(-1, 0, 0, ctx).bulge).toBeLessThan(0.01);
    expect(skyStructure(0, 1, 0, ctx).bulge).toBeLessThan(0.01);
  });

  it('varies with the seed', () => {
    const a = skyStructure(...unit(0.3, 0.9, 0.05), ctx);
    const b = skyStructure(...unit(0.3, 0.9, 0.05), { ...ctx, seed: 99 });
    expect(a.cloud).not.toBe(b.cloud);
  });
});

describe('bakeSkyStructure / sampleSkyMap', () => {
  const ctx = { coreX: 0, coreY: 1, seed: 42 };
  const map = bakeSkyStructure(ctx);
  const out: SkySample = { bulge: 0, cloud: 0, disk: 0, dust: 0 };

  it('bakes dust in sparse filaments within the band', () => {
    let band = 0;
    let dusty = 0;
    for (let i = 0; i < map.data.length; i += 4) {
      if ((map.data[i + 3] ?? 0) > 128) {
        band++;
        if ((map.data[i + 1] ?? 0) > 64)
          dusty++;
      }
    }
    expect(dusty).toBeGreaterThan(0);
    expect(dusty / band).toBeLessThan(0.3);
  });

  it('samples back the field at texel centres', () => {
    for (const [px, py] of [[100, 128], [300, 120], [450, 140]] as const) {
      const d = pixelToDir(px + 0.5, py + 0.5, map.width, map.height);
      const s = sampleSkyMap(map, d.x, d.y, d.z, out);
      const f = skyStructure(d.x, d.y, d.z, ctx);
      expect(s.disk).toBeCloseTo(f.disk, 2);
      expect(s.cloud).toBeCloseTo(f.cloud, 2);
      expect(s.bulge).toBeCloseTo(f.bulge, 2);
    }
  });

  it('wraps smoothly across the azimuth seam', () => {
    const a = sampleSkyMap(map, 1, -1e-6, 0, out).disk;
    const b = sampleSkyMap(map, 1, 1e-6, 0, out).disk;
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});
