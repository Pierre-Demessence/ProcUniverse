import { makeSeededRng } from '@pierre/ecs/modules/rng';
import { describe, expect, it } from 'vitest';

import {
  atmosphereType,
  centralPressure,
  classifyType,
  compositionClass,
  earthSimilarityIndex,
  equilibriumTemp,
  escapeVelocity,
  frostLine,
  habitableZone,
  massToRadius,
  oblateness,
  retainsAtmosphere,
  samplePlanet,
  surfaceGravity,
  surfaceTemperature,
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
    expect(samplePlanet(makeSeededRng(9), 1, 1.5, 1, 4.6e9)).toEqual(samplePlanet(makeSeededRng(9), 1, 1.5, 1, 4.6e9));
  });

  it('consumes exactly five rng draws (mass, rotation, tilt, moons, rings)', () => {
    const withPlanet = makeSeededRng(5);
    samplePlanet(withPlanet, 1, 1, 1, 4.6e9);
    const after = withPlanet();
    const direct = makeSeededRng(5);
    for (let i = 0; i < 5; i++)
      direct();
    expect(after).toBe(direct());
  });

  it('derives well-formed, self-consistent data', () => {
    const planet = samplePlanet(makeSeededRng(2026), 1, 1, 1, 4.6e9);
    expect(planet.mass).toBeGreaterThan(0);
    expect(planet.radius).toBeGreaterThan(0);
    expect(planet.density).toBeGreaterThan(0);
    expect(planet.equilibriumTemp).toBeGreaterThan(0);
    expect(planet.rotationPeriod).toBeGreaterThan(0);
    expect(planet.obliquity).toBeGreaterThanOrEqual(0);
    expect(planet.obliquity).toBeLessThanOrEqual(180);
    expect(planet.moonCount).toBeGreaterThanOrEqual(0);
    expect(typeof planet.hasRings).toBe('boolean');
    expect(typeof planet.tidallyLocked).toBe('boolean');
    expect(['rocky', 'super-earth', 'ice-giant', 'gas-giant']).toContain(planet.type);
    expect(['ice', 'liquid', 'vapour']).toContain(planet.waterState);
  });

  it('keeps gas giants beyond the frost line', () => {
    const frost = frostLine(1);
    const rng = makeSeededRng(42);
    let innerGiants = 0;
    let outerGiants = 0;
    for (let i = 0; i < 300; i++) {
      const inside = samplePlanet(rng, 1, frost * 0.3, 1, 4.6e9);
      if (inside.type === 'gas-giant' || inside.type === 'ice-giant')
        innerGiants++;
      const outside = samplePlanet(rng, 1, frost * 2, 1, 4.6e9);
      if (outside.type === 'gas-giant')
        outerGiants++;
    }
    expect(innerGiants).toBe(0);
    expect(outerGiants).toBeGreaterThan(0);
  });

  it('stores insolation as L / a² (Earth = 1 at 1 AU, 1 L☉)', () => {
    expect(samplePlanet(makeSeededRng(1), 1, 1, 1, 4.6e9).insolation).toBeCloseTo(1, 6);
    expect(samplePlanet(makeSeededRng(1), 1, 2, 1, 4.6e9).insolation).toBeCloseTo(0.25, 6);
    expect(samplePlanet(makeSeededRng(1), 4, 1, 1, 4.6e9).insolation).toBeCloseTo(4, 6);
  });

  it('tidally locks a close-in planet around an old star, not a distant one', () => {
    const close = samplePlanet(makeSeededRng(3), 0.04, 0.05, 0.2, 10e9);
    const far = samplePlanet(makeSeededRng(3), 0.04, 5, 0.2, 10e9);
    expect(close.tidallyLocked).toBe(true);
    expect(far.tidallyLocked).toBe(false);
    expect(close.rotationPeriod).toBeGreaterThan(0);
  });

  it('gives giants more moons on average than rocky worlds', () => {
    const rng = makeSeededRng(99);
    let giantMoons = 0;
    let giantN = 0;
    let rockyMoons = 0;
    let rockyN = 0;
    for (let i = 0; i < 2000; i++) {
      const giant = samplePlanet(rng, 1, 8, 1, 4.6e9);
      if (giant.type === 'gas-giant' || giant.type === 'ice-giant') {
        giantMoons += giant.moonCount;
        giantN++;
      }
      const rocky = samplePlanet(rng, 1, 0.5, 1, 4.6e9);
      if (rocky.type === 'rocky') {
        rockyMoons += rocky.moonCount;
        rockyN++;
      }
    }
    expect(giantN).toBeGreaterThan(0);
    expect(rockyN).toBeGreaterThan(0);
    expect(giantMoons / giantN).toBeGreaterThan(rockyMoons / rockyN);
  });

  it('never leaves a giant moonless and averages a realistic major-moon count', () => {
    const rng = makeSeededRng(7);
    let giantMin = Number.POSITIVE_INFINITY;
    let giantMoons = 0;
    let giantN = 0;
    for (let i = 0; i < 3000; i++) {
      const giant = samplePlanet(rng, 1, 8, 1, 4.6e9);
      if (giant.type === 'gas-giant' || giant.type === 'ice-giant') {
        giantMin = Math.min(giantMin, giant.moonCount);
        giantMoons += giant.moonCount;
        giantN++;
      }
    }
    expect(giantN).toBeGreaterThan(0);
    expect(giantMin).toBeGreaterThanOrEqual(1); // every real giant hosts moons
    const mean = giantMoons / giantN;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(10);
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

describe('oblateness', () => {
  it('flattens a fast-spinning giant far more than a slow rocky world', () => {
    // Jupiter-ish: 11.2 R⊕, 318 M⊕, ~10 h spin → ~6.5%.
    const jupiter = oblateness(10, 318, 11.2);
    expect(jupiter).toBeGreaterThan(0.04);
    expect(jupiter).toBeLessThan(0.12);
    // Earth: 24 h → tiny; faster spin → more oblate.
    expect(oblateness(24, 1, 1)).toBeLessThan(0.01);
    expect(oblateness(5, 1, 1)).toBeGreaterThan(oblateness(24, 1, 1));
  });
});

describe('atmosphere & surface temperature', () => {
  it('keeps an atmosphere on Earth/Venus/Mars but not the Moon or Mercury (cosmic shoreline)', () => {
    expect(retainsAtmosphere(11.19, 1)).toBe(true); // Earth
    expect(retainsAtmosphere(10.36, 1.9)).toBe(true); // Venus
    expect(retainsAtmosphere(5.03, 0.43)).toBe(true); // Mars (thin)
    expect(retainsAtmosphere(2.38, 1)).toBe(false); // Moon
    expect(retainsAtmosphere(4.25, 6.6)).toBe(false); // Mercury
  });

  it('labels atmosphere by type and temperature, or None below the shoreline', () => {
    expect(atmosphereType('rocky', false, 288)).toBe('None');
    expect(atmosphereType('gas-giant', true, 120)).toBe('Hydrogen / helium');
    expect(atmosphereType('ice-giant', true, 70)).toBe('H/He + methane');
    expect(atmosphereType('rocky', true, 700)).toBe('CO₂ (runaway)');
    expect(atmosphereType('rocky', true, 288)).toBe('N₂ / CO₂');
    expect(atmosphereType('rocky', true, 150)).toBe('Thin N₂');
  });

  it('adds an Earth-like greenhouse and none for airless or giant worlds', () => {
    expect(surfaceTemperature(255, 'rocky', true)).toBeCloseTo(288, 0);
    expect(surfaceTemperature(255, 'rocky', false)).toBe(255);
    expect(surfaceTemperature(120, 'gas-giant', true)).toBe(120);
    expect(surfaceTemperature(400, 'rocky', true)).toBeGreaterThan(400 + 33);
  });
});

describe('metallicity and planet mass', () => {
  it('forms more massive planets in metal-rich systems', () => {
    const poor = makeSeededRng(33);
    const rich = makeSeededRng(33);
    let poorMass = 0;
    let richMass = 0;
    for (let i = 0; i < 500; i++) {
      poorMass += samplePlanet(poor, 1, 1, 1, 4.6e9, -0.5).mass;
      richMass += samplePlanet(rich, 1, 1, 1, 4.6e9, 0.5).mass;
    }
    expect(richMass).toBeGreaterThan(poorMass);
  });
});
