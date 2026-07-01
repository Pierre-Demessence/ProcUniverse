import type { OrbitElements } from '../sim/orbits';

import { describe, expect, it } from 'vitest';

import { frameZoom, maxApoapsis } from './focus';

function orbit(a: number, e: number): OrbitElements {
  return { a, argPeriapsis: 0, cx: 0, cy: 0, e, meanAnomaly0: 0, parent: -1, starMass: 1 };
}

describe('frameZoom', () => {
  const vpW = 1920;
  const vpH = 1080;
  const margin = 1.4;
  const minZoom = 1e-12;
  const maxZoom = 1e7;

  it('frames an extent exactly, leaving margin on both sides', () => {
    // extentAu=1, min(vpW,vpH)=1080, zoom=1080/(2*1*1.4)=385.71...
    const z = frameZoom(1, vpW, vpH, margin, minZoom, maxZoom);
    expect(z).toBeCloseTo(1080 / (2 * 1.4), 2);
  });

  it('uses the smaller viewport axis', () => {
    const z = frameZoom(10, vpW, vpH, margin, minZoom, maxZoom);
    expect(z).toBeCloseTo(1080 / (2 * 10 * 1.4), 2);
  });

  it('clamps at the minimum zoom for a huge extent', () => {
    expect(frameZoom(1e20, vpW, vpH, margin, minZoom, maxZoom)).toBe(minZoom);
  });

  it('clamps at the maximum zoom for a tiny extent', () => {
    expect(frameZoom(1e-20, vpW, vpH, margin, minZoom, maxZoom)).toBe(maxZoom);
  });

  it('zooms tighter when the viewport is smaller', () => {
    const zSmall = frameZoom(1, 320, 200, margin, minZoom, maxZoom);
    expect(zSmall).toBeCloseTo(200 / (2 * 1.4), 2);
    expect(zSmall).toBeLessThan(frameZoom(1, vpW, vpH, margin, minZoom, maxZoom));
  });

  it('scales inversely with margin', () => {
    const tight = frameZoom(1, vpW, vpH, 1, minZoom, maxZoom);
    const loose = frameZoom(1, vpW, vpH, 2, minZoom, maxZoom);
    expect(loose).toBeCloseTo(tight / 2, 5);
  });
});

describe('maxApoapsis', () => {
  it('returns 0 for an empty list', () => {
    expect(maxApoapsis([])).toBe(0);
  });

  it('returns a*(1+e) for a single orbit', () => {
    expect(maxApoapsis([orbit(2, 0.1)])).toBeCloseTo(2 * 1.1, 10);
  });

  it('returns the maximum across several orbits', () => {
    const orbits = [
      orbit(1, 0.05), // apo = 1.05
      orbit(3, 0.2), // apo = 3.60
      orbit(0.5, 0.9), // apo = 0.95
    ];
    expect(maxApoapsis(orbits)).toBeCloseTo(3.6, 10);
  });

  it('handles perfectly circular orbits (e=0)', () => {
    expect(maxApoapsis([orbit(5, 0)])).toBeCloseTo(5, 10);
  });
});
