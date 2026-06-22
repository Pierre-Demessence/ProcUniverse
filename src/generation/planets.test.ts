import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import {
  centralPressure,
  classifyType,
  compositionClass,
  earthSimilarityIndex,
  equilibriumTemp,
  escapeVelocity,
  frostLine,
  habitableZone,
  massToRadius,
  samplePlanet,
  surfaceGravity,
} from './planets';

describe('frost line and habitable zone', () => {
  it('places the Sun frost line near 2.7 AU and scales as sqrt(L)', () => {
    expect(frostLine(1)).toBeCloseTo(2.7, 6);
    expect(frostLine(4)).toBeCloseTo(5.4, 6);
  });

  it('brackets ~1 AU for the Sun and scales as sqrt(L)', () => {
    const hz = habitableZone(1);
    expect(hz.inner).toBeLessThan(1);
    expect(hz.outer).toBeGreaterThan(1);
    expect(hz.inner).toBeCloseTo(0.95, 6);
    expect(habitableZone(4).inner).toBeCloseTo(1.9, 6);
  });
});

describe('equilibriumTemp', () => {
  it('reproduces Earth (1 L☉, 1 AU, A=0.3) ≈ 255 K', () => {
    expect(equilibriumTemp(1, 1, 0.3)).toBeCloseTo(255, 0);
  });

  it('is hotter closer in and colder further out', () => {
    expect(equilibriumTemp(1, 0.5, 0.3)).toBeGreaterThan(equilibriumTemp(1, 1, 0.3));
    expect(equilibriumTemp(1, 5, 0.3)).toBeLessThan(equilibriumTemp(1, 1, 0.3));
  });
});

describe('massToRadius (Forecaster)', () => {
  it('anchors Earth at 1 R⊕', () => {
    expect(massToRadius(1)).toBeCloseTo(1, 6);
  });

  it('grows through the rocky and Neptunian regimes', () => {
    expect(massToRadius(5)).toBeGreaterThan(massToRadius(1));
    expect(massToRadius(50)).toBeGreaterThan(massToRadius(5));
    expect(massToRadius(300)).toBeGreaterThan(massToRadius(10));
  });
});

describe('classifyType', () => {
  it('never makes a giant inside the frost line', () => {
    expect(classifyType(1, false)).toBe('rocky');
    expect(classifyType(5, false)).toBe('super-earth');
    expect(classifyType(40, false)).toBe('super-earth');
  });

  it('forms ice and gas giants beyond the frost line', () => {
    expect(classifyType(20, true)).toBe('ice-giant');
    expect(classifyType(200, true)).toBe('gas-giant');
  });
});

describe('samplePlanet', () => {
  it('is deterministic for the same rng stream', () => {
    expect(samplePlanet(makeSeededRng(9), 1, 1.5)).toEqual(samplePlanet(makeSeededRng(9), 1, 1.5));
  });

  it('consumes exactly one rng draw', () => {
    const withPlanet = makeSeededRng(5);
    samplePlanet(withPlanet, 1, 1);
    const after = withPlanet();
    const direct = makeSeededRng(5);
    direct();
    expect(after).toBe(direct());
  });

  it('derives well-formed, self-consistent data', () => {
    const planet = samplePlanet(makeSeededRng(2026), 1, 1);
    expect(planet.mass).toBeGreaterThan(0);
    expect(planet.radius).toBeGreaterThan(0);
    expect(planet.density).toBeGreaterThan(0);
    expect(planet.equilibriumTemp).toBeGreaterThan(0);
    expect(['rocky', 'super-earth', 'ice-giant', 'gas-giant']).toContain(planet.type);
    expect(['ice', 'liquid', 'vapour']).toContain(planet.waterState);
  });

  it('keeps gas giants beyond the frost line', () => {
    const frost = frostLine(1);
    const rng = makeSeededRng(42);
    let innerGiants = 0;
    let outerGiants = 0;
    for (let i = 0; i < 300; i++) {
      const inside = samplePlanet(rng, 1, frost * 0.3);
      if (inside.type === 'gas-giant' || inside.type === 'ice-giant')
        innerGiants++;
      const outside = samplePlanet(rng, 1, frost * 2);
      if (outside.type === 'gas-giant')
        outerGiants++;
    }
    expect(innerGiants).toBe(0);
    expect(outerGiants).toBeGreaterThan(0);
  });

  it('stores insolation as L / a² (Earth = 1 at 1 AU, 1 L☉)', () => {
    expect(samplePlanet(makeSeededRng(1), 1, 1).insolation).toBeCloseTo(1, 6);
    expect(samplePlanet(makeSeededRng(1), 1, 2).insolation).toBeCloseTo(0.25, 6);
    expect(samplePlanet(makeSeededRng(1), 4, 1).insolation).toBeCloseTo(4, 6);
  });
});

describe('surfaceGravity', () => {
  it('is 1 g⊕ for Earth and scales as M / R²', () => {
    expect(surfaceGravity(1, 1)).toBeCloseTo(1, 6);
    expect(surfaceGravity(4, 2)).toBeCloseTo(1, 6);
    expect(surfaceGravity(2, 1)).toBeCloseTo(2, 6);
  });
});

describe('escapeVelocity', () => {
  it('is ~11.19 km/s for Earth and scales as √(M/R)', () => {
    expect(escapeVelocity(1, 1)).toBeCloseTo(11.186, 3);
    expect(escapeVelocity(4, 1)).toBeCloseTo(2 * 11.186, 3);
  });
});

describe('centralPressure', () => {
  it('anchors Earth at ~364 GPa and scales as M² / R⁴', () => {
    expect(centralPressure(1, 1)).toBeCloseTo(364, 6);
    expect(centralPressure(2, 1)).toBeCloseTo(364 * 4, 6);
  });
});

describe('compositionClass', () => {
  it('labels giants by class and small worlds by density', () => {
    expect(compositionClass('gas-giant', 1.3)).toBe('Gaseous (H/He)');
    expect(compositionClass('ice-giant', 1.6)).toBe('Icy (H/He, ices)');
    expect(compositionClass('super-earth', 8)).toBe('Iron-rich');
    expect(compositionClass('rocky', 5.5)).toBe('Rocky');
    expect(compositionClass('rocky', 2)).toBe('Water / ice');
    expect(compositionClass('rocky', 0.8)).toBe('Volatile-rich');
  });
});

describe('earthSimilarityIndex', () => {
  it('is 1 for an Earth twin and falls off for unlike worlds', () => {
    expect(earthSimilarityIndex(1, 5.514, 11.186, 255)).toBeCloseTo(1, 6);
    expect(earthSimilarityIndex(11, 1.3, 60, 110)).toBeLessThan(0.4);
  });
});
