import { SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { ATMOSPHERE_LOOKS, MOON_SURFACE, ROCKY_SURFACE } from '../../config/render';
import { moonPhysicalFromMass } from '../../generation/moons';
import { ATMOSPHERE_KINDS, atmosphereColumn, atmosphereKind, equirectDirection, isIcyMoon, moonSurface, planetVarietySeed, rockPalette, rockyRegime, shellRadius, VARIETY_SEED_RANGE } from './planet-surface';

const JUPITER = { equilibriumTemp: 110, mass: 317.8, radius: 11.2, rotationPeriod: 9.9 };

describe('planetVarietySeed', () => {
  it('is deterministic', () => {
    expect(planetVarietySeed(JUPITER)).toBe(planetVarietySeed({ ...JUPITER }));
  });

  it('stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const seed = planetVarietySeed({ ...JUPITER, mass: i * 1.7 });
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(VARIETY_SEED_RANGE);
    }
  });

  it('separates near-identical planets', () => {
    const a = planetVarietySeed(JUPITER);
    const b = planetVarietySeed({ ...JUPITER, mass: JUPITER.mass + 1e-9 });
    expect(Math.abs(a - b)).toBeGreaterThan(1);
  });
});

describe('equirectDirection', () => {
  it('matches SphereGeometry vertices at their UVs', () => {
    const geometry = new SphereGeometry(1, 16, 12);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = equirectDirection(uv.getX(i), uv.getY(i));
      expect(x).toBeCloseTo(position.getX(i), 5);
      expect(y).toBeCloseTo(position.getY(i), 5);
      expect(z).toBeCloseTo(position.getZ(i), 5);
    }
    geometry.dispose();
  });

  it('puts v = 1 on the +Y pole', () => {
    expect(equirectDirection(0.3, 1)[1]).toBeCloseTo(1);
    expect(equirectDirection(0.3, 0)[1]).toBeCloseTo(-1);
  });
});

describe('atmosphereKind', () => {
  it('gives giants their hydrogen / methane families', () => {
    expect(atmosphereKind({ ...JUPITER, insolation: 0.04, type: 'gas-giant' })).toBe('hydrogen');
    expect(atmosphereKind({ equilibriumTemp: 60, insolation: 0.003, mass: 17, radius: 3.9, type: 'ice-giant' })).toBe('methane');
  });

  it('gives an Earth twin N₂/CO₂ and strips a small hot rock', () => {
    expect(atmosphereKind({ equilibriumTemp: 255, insolation: 1, mass: 1, radius: 1, type: 'rocky' })).toBe('n2-co2');
    expect(atmosphereKind({ equilibriumTemp: 900, insolation: 3000, mass: 0.05, radius: 0.4, type: 'rocky' })).toBeNull();
  });
});

describe('aTMOSPHERE_LOOKS', () => {
  it('covers every atmosphere kind', () => {
    for (const kind of ATMOSPHERE_KINDS)
      expect(ATMOSPHERE_LOOKS[kind]).toBeDefined();
  });
});

describe('atmosphereColumn', () => {
  const H = 0.03;

  it('meets at the limb from both sides', () => {
    expect(atmosphereColumn(1, H)).toBeCloseTo(1);
    expect(atmosphereColumn(1 - 1e-6, H)).toBeCloseTo(1);
  });

  it('fades to nothing at the shell edge', () => {
    expect(atmosphereColumn(shellRadius(H), H)).toBeLessThan(0.01);
  });

  it('is a faint haze at the disc centre, thickening toward the limb', () => {
    expect(atmosphereColumn(0, H)).toBeLessThan(0.1);
    expect(atmosphereColumn(0.9, H)).toBeGreaterThan(atmosphereColumn(0, H));
  });
});

describe('rockPalette', () => {
  const anchors = [
    { high: '#ffffff', low: '#000000', tempK: 100 },
    { high: '#000000', low: '#ffffff', tempK: 300 },
  ];

  it('interpolates between the surrounding anchors', () => {
    const { high, low } = rockPalette(200, anchors);
    expect(high[0]).toBeCloseTo(0.5);
    expect(low[0]).toBeCloseTo(0.5);
  });

  it('clamps outside the anchor range', () => {
    expect(rockPalette(10, anchors).high).toEqual([1, 1, 1]);
    expect(rockPalette(5000, anchors).high).toEqual([0, 0, 0]);
  });
});

describe('rockyRegime', () => {
  const EARTH = { density: 5.5, equilibriumTemp: 255, hasRings: false, inHabitableZone: true, insolation: 1, mass: 1, moonRichness: 0.5, obliquity: 23, obliquityAzimuth: 0, radius: 1, rotationPeriod: 24, tidallyLocked: false, type: 'rocky', waterState: 'liquid' } as const;

  it('gives a temperate water world oceans, small caps and softened craters', () => {
    const regime = rockyRegime(EARTH, ROCKY_SURFACE);
    expect(regime.ocean).toBe(true);
    expect(regime.molten).toBe(0);
    expect(regime.capStart).toBeGreaterThan(0.8);
    expect(regime.craters).toBe(ROCKY_SURFACE.craterAtmosphereFactor);
  });

  it('melts a roasting airless world: lava, no oceans, no caps, full craters', () => {
    const regime = rockyRegime({ ...EARTH, equilibriumTemp: 2000, insolation: 5000, mass: 0.05, radius: 0.4 }, ROCKY_SURFACE);
    expect(regime.molten).toBe(1);
    expect(regime.ocean).toBe(false);
    expect(regime.capStart).toBeGreaterThan(1);
    expect(regime.craters).toBe(1);
  });

  it('grows caps as a world cools', () => {
    const cold = rockyRegime({ ...EARTH, equilibriumTemp: 130, waterState: 'ice' }, ROCKY_SURFACE);
    const cool = rockyRegime({ ...EARTH, equilibriumTemp: 200, waterState: 'ice' }, ROCKY_SURFACE);
    expect(cold.capStart).toBeLessThan(cool.capStart);
  });
});

describe('rOCKY_SURFACE', () => {
  it('lists palette anchors in ascending temperature', () => {
    const temps = ROCKY_SURFACE.anchors.map(a => a.tempK);
    expect(temps).toEqual([...temps].sort((a, b) => a - b));
  });
});

describe('moonSurface', () => {
  const small = moonPhysicalFromMass(1e-3, true);
  const big = moonPhysicalFromMass(0.04, true);

  it('makes a small cold moon icy and a big or warm one rocky', () => {
    expect(isIcyMoon(small, 100, MOON_SURFACE)).toBe(true);
    expect(isIcyMoon(big, 100, MOON_SURFACE)).toBe(false);
    expect(isIcyMoon(small, 300, MOON_SURFACE)).toBe(false);
  });

  it('is airless: full craters, no ocean, no caps, moon knobs override rocky ones', () => {
    const { regime, tuning } = moonSurface(big, 250, ROCKY_SURFACE, MOON_SURFACE);
    expect(regime.ocean).toBe(false);
    expect(regime.craters).toBe(1);
    expect(regime.capStart).toBeGreaterThan(1);
    expect(tuning.craterDensity).toBe(MOON_SURFACE.craterDensity);
    expect(tuning.seaLevel).toBe(ROCKY_SURFACE.seaLevel);
  });
});
