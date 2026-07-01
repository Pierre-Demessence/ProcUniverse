import { describe, expect, it } from 'vitest';

import { BODY_FLOOR_MAX_PX, BODY_FLOOR_MIN_PX, MOON_FLOOR_MIN_PX } from '../config/render';
import { bodyFloorPx, drawnBodyRadiusAu } from './body-scale';

// Representative true radii in AU: a moon, Earth, Jupiter, the Sun, a giant star.
const MOON_AU = 1.16e-5;
const EARTH_AU = 4.26e-5;
const JUPITER_AU = 4.67e-4;
const SUN_AU = 4.65e-3;
const GIANT_AU = 5e-2;

describe('bodyFloorPx', () => {
  it('is monotonic in true radius (a bigger body never floors smaller)', () => {
    expect(bodyFloorPx(EARTH_AU)).toBeGreaterThanOrEqual(bodyFloorPx(MOON_AU));
    expect(bodyFloorPx(JUPITER_AU)).toBeGreaterThanOrEqual(bodyFloorPx(EARTH_AU));
    expect(bodyFloorPx(SUN_AU)).toBeGreaterThanOrEqual(bodyFloorPx(JUPITER_AU));
    expect(bodyFloorPx(GIANT_AU)).toBeGreaterThanOrEqual(bodyFloorPx(SUN_AU));
  });

  it('clamps to the configured pixel range', () => {
    expect(bodyFloorPx(1e-12)).toBe(BODY_FLOOR_MIN_PX);
    expect(bodyFloorPx(1e6)).toBe(BODY_FLOOR_MAX_PX);
  });

  it('orders a Sun above Earth but keeps a red dwarf ≈ Jupiter (real ratios)', () => {
    expect(bodyFloorPx(SUN_AU)).toBeGreaterThan(bodyFloorPx(EARTH_AU));
    // A ~0.1 R☉ red dwarf and Jupiter have near-identical true radii, so their
    // markers stay similar — the map preserves real size ratios, not a lie.
    const redDwarfAu = 0.1 * SUN_AU;
    expect(Math.abs(bodyFloorPx(redDwarfAu) - bodyFloorPx(JUPITER_AU))).toBeLessThan(0.5);
  });
});

describe('drawnBodyRadiusAu', () => {
  it('draws the true radius in true-scale mode, at any zoom', () => {
    expect(drawnBodyRadiusAu(SUN_AU, 1e-6, 'true')).toBe(SUN_AU);
    expect(drawnBodyRadiusAu(SUN_AU, 1e6, 'true')).toBe(SUN_AU);
  });

  it('floors to a minimum pixel size when zoomed out (usable)', () => {
    const zoom = 1; // 1 px/AU: the Sun (~0.0046 AU) would be sub-pixel
    const drawn = drawnBodyRadiusAu(SUN_AU, zoom, 'usable');
    expect(drawn).toBeGreaterThan(SUN_AU);
    expect(drawn * zoom).toBeCloseTo(bodyFloorPx(SUN_AU), 6); // exactly the floor, in px
  });

  it('reaches true scale when zoomed in past the floor (usable)', () => {
    expect(drawnBodyRadiusAu(SUN_AU, 1e6, 'usable')).toBe(SUN_AU);
  });

  it('raises the floor for moons via minFloorPx (usable)', () => {
    const zoom = 1;
    const base = drawnBodyRadiusAu(MOON_AU, zoom, 'usable');
    const moon = drawnBodyRadiusAu(MOON_AU, zoom, 'usable', MOON_FLOOR_MIN_PX);
    expect(base * zoom).toBeCloseTo(BODY_FLOOR_MIN_PX, 6); // base floors a moon low
    expect(moon).toBeGreaterThan(base);
    expect(moon * zoom).toBeCloseTo(MOON_FLOOR_MIN_PX, 6);
  });

  it('only lifts bodies below the moon minimum, not larger ones', () => {
    // The Sun's floor (~6.9px) already exceeds MOON_FLOOR_MIN_PX, so applying the
    // moon floor leaves it unchanged; only sub-minimum bodies (moons) are raised.
    expect(drawnBodyRadiusAu(SUN_AU, 1, 'usable', MOON_FLOOR_MIN_PX)).toBe(drawnBodyRadiusAu(SUN_AU, 1, 'usable'));
  });
});
