import type { GalaxyParams } from './galaxies';

import { describe, expect, it } from 'vitest';

import { BLACK_HOLE_MASS_MAX, BLACK_HOLE_MASS_MIN, GALAXY_CELL_LY } from '../config';
import { SECTOR_SIZE } from '../scale';
import {
  blackHoleMassFromSize,
  cosmicDensity,
  eddingtonLuminosity,
  environmentClass,
  estimatedStarCount,
  evaporationTime,
  galaxiesInRect,
  galaxyActivityOf,
  galaxyAt,
  galaxyCenteredIn,
  galaxyDensityAt,
  galaxyDensityOf,
  galaxyDiameterLy,
  galaxyRepresentativeActivity,
  hawkingTemperature,
  innermostStableOrbit,
  makeGalaxy,
  photonSphere,
  shadowDiameter,
  velocityDispersion,
} from './galaxies';
import { AU_PER_LY } from './units';

const SEED = 1337;

const spiral: GalaxyParams = {
  name: 'NGC-TEST0',
  arms: 2,
  armStrength: 0.7,
  blackHoleMass: 1e7,
  blackHoleSpin: 0.5,
  centerX: 1000,
  centerY: 1000,
  cosmicDensity: 0.5,
  dwarf: false,
  ellipticity: 1,
  orientation: 0,
  phase: 0,
  pitch: (18 * Math.PI) / 180,
  radius: 1000,
  scaleLength: 300,
  schwarzschildRadius: 0.2,
  type: 'spiral',
};
const elliptical: GalaxyParams = { ...spiral, ellipticity: 0.6, type: 'elliptical' };

describe('galaxyDensityOf', () => {
  it('peaks at the core and vanishes beyond the radius', () => {
    expect(galaxyDensityOf(spiral, 1000, 1000)).toBe(1);
    expect(galaxyDensityOf(spiral, 3000, 1000)).toBe(0);
    expect(galaxyDensityOf(spiral, 1000, 3000)).toBe(0);
  });

  it('falls off with distance from the core', () => {
    expect(galaxyDensityOf(spiral, 1100, 1000)).toBeGreaterThan(galaxyDensityOf(spiral, 1600, 1000));
  });

  it('stays within [0, 1] across the disc', () => {
    for (let dx = -1000; dx <= 1000; dx += 137) {
      for (let dy = -1000; dy <= 1000; dy += 137) {
        const d = galaxyDensityOf(spiral, 1000 + dx, 1000 + dy);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('squashes an elliptical galaxy along its minor axis', () => {
    expect(galaxyDensityOf(elliptical, 1300, 1000)).toBeGreaterThan(galaxyDensityOf(elliptical, 1000, 1300));
  });
});

describe('galaxyActivityOf', () => {
  it('is low and uniform for an elliptical (old, red population)', () => {
    const a = galaxyActivityOf(elliptical, 1300, 1000);
    expect(a).toBe(galaxyActivityOf(elliptical, 1000, 1300));
    expect(a).toBeLessThan(0.2);
  });

  it('varies across a spiral and rises above the quiescent baseline on arms', () => {
    const baseline = galaxyActivityOf(elliptical, 1300, 1000);
    let maxA = 0;
    let minA = 1;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const a = galaxyActivityOf(spiral, 1000 + 300 * Math.cos(rad), 1000 + 300 * Math.sin(rad));
      maxA = Math.max(maxA, a);
      minA = Math.min(minA, a);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(maxA - minA).toBeGreaterThan(0.1);
    expect(maxA).toBeGreaterThan(baseline);
  });
});

describe('blackHoleMassFromSize', () => {
  it('grows with galaxy size and an early-type boost, within bounds', () => {
    const small = blackHoleMassFromSize(0.1, false, 0.5);
    const large = blackHoleMassFromSize(0.9, false, 0.5);
    expect(large).toBeGreaterThan(small);
    expect(blackHoleMassFromSize(0.5, true, 0.5)).toBeGreaterThan(blackHoleMassFromSize(0.5, false, 0.5));
    expect(small).toBeGreaterThanOrEqual(BLACK_HOLE_MASS_MIN);
    expect(large).toBeLessThanOrEqual(BLACK_HOLE_MASS_MAX);
  });
});

describe('makeGalaxy', () => {
  it('always fills the home cell, centred on the origin', () => {
    const home = makeGalaxy(SEED, 0, 0);
    expect(home).not.toBeNull();
    if (home) {
      expect(home.centerX).toBe(0);
      expect(home.centerY).toBe(0);
    }
  });

  it('is deterministic per cell and leaves some cells empty', () => {
    expect(makeGalaxy(SEED, 3, 5)).toEqual(makeGalaxy(SEED, 3, 5));
    let nulls = 0;
    let filled = 0;
    for (let gx = -4; gx <= 4; gx++) {
      for (let gy = -4; gy <= 4; gy++) {
        if (makeGalaxy(SEED, gx, gy))
          filled++;
        else
          nulls++;
      }
    }
    expect(nulls).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(0);
  });

  it('regenerates every cell byte-identically regardless of morphology branch', () => {
    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -3; gy <= 3; gy++)
        expect(makeGalaxy(SEED, gx, gy)).toEqual(makeGalaxy(SEED, gx, gy));
    }
  });

  it('draws several morphologies across the grid', () => {
    const types = new Set<string>();
    for (let gx = -10; gx <= 10; gx++) {
      for (let gy = -10; gy <= 10; gy++) {
        const g = makeGalaxy(SEED, gx, gy);
        if (g)
          types.add(g.type);
      }
    }
    expect(types.size).toBeGreaterThanOrEqual(3);
  });
});

describe('galaxyAt / galaxyDensityAt / galaxyCenteredIn', () => {
  it('finds the home galaxy at the origin', () => {
    expect(galaxyDensityAt(SEED, 0, 0)).toBeCloseTo(1, 5);
    expect(galaxyAt(SEED, 0, 0)?.centerX).toBe(0);
  });

  it('returns nothing in an empty cell far from any galaxy', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    let empty: [number, number] | null = null;
    for (let gx = 1; gx <= 30 && !empty; gx++) {
      for (let gy = 0; gy <= 30 && !empty; gy++) {
        if (!makeGalaxy(SEED, gx, gy))
          empty = [gx, gy];
      }
    }
    expect(empty).not.toBeNull();
    if (empty) {
      const x = (empty[0] + 0.5) * cell;
      const y = (empty[1] + 0.5) * cell;
      expect(galaxyDensityAt(SEED, x, y)).toBe(0);
      expect(galaxyAt(SEED, x, y)).toBeNull();
    }
  });

  it('reports a galaxy centre inside its own sector box only', () => {
    expect(galaxyCenteredIn(SEED, 0, 0, SECTOR_SIZE, SECTOR_SIZE)?.centerX).toBe(0);
    expect(galaxyCenteredIn(SEED, 7 * SECTOR_SIZE, 0, 8 * SECTOR_SIZE, SECTOR_SIZE)).toBeNull();
  });
});

describe('galaxy-field helpers', () => {
  it('reports a positive diameter and a star estimate that grows with size', () => {
    expect(galaxyDiameterLy(spiral)).toBeGreaterThan(0);
    const big = { ...spiral, scaleLength: spiral.scaleLength * 2 };
    expect(estimatedStarCount(big)).toBeGreaterThan(estimatedStarCount(spiral));
  });

  it('colours spirals younger (bluer) than spheroidals', () => {
    expect(galaxyRepresentativeActivity(spiral)).toBeGreaterThan(galaxyRepresentativeActivity(elliptical));
  });

  it('iterates galaxies overlapping a rect, including the home galaxy', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const found = [...galaxiesInRect(SEED, -cell, -cell, cell, cell)];
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(g => g.centerX === 0 && g.centerY === 0)).toBe(true);
  });
});

describe('black-hole derived quantities', () => {
  it('anchors the per-solar-mass values and scales with mass', () => {
    expect(hawkingTemperature(1)).toBeCloseTo(6.17e-8, 10);
    expect(eddingtonLuminosity(1)).toBeCloseTo(3.3e4, 1);
    expect(hawkingTemperature(2) / hawkingTemperature(1)).toBeCloseTo(0.5, 6);
    expect(evaporationTime(2) / evaporationTime(1)).toBeCloseTo(8, 6);
    expect(eddingtonLuminosity(5) / eddingtonLuminosity(1)).toBeCloseTo(5, 6);
  });

  it('places the photon sphere, ISCO, and shadow at multiples of r_s', () => {
    expect(photonSphere(0.2)).toBeCloseTo(0.3, 6);
    expect(innermostStableOrbit(0.2)).toBeCloseTo(0.6, 6); // Schwarzschild: 3·r_s
    expect(innermostStableOrbit(0.2, 0.5)).toBeLessThan(0.6); // spin shrinks the ISCO
    expect(innermostStableOrbit(0.2, 0.9999)).toBeLessThan(0.12); // max prograde Kerr → ~0.5·r_s
    expect(innermostStableOrbit(0.2, 0.9999)).toBeGreaterThan(0.09);
    expect(shadowDiameter(0.2)).toBeCloseTo(1.04, 6);
  });
});

describe('galaxy derived quantities', () => {
  it('inverts the M–σ relation (heavier black hole → higher dispersion)', () => {
    expect(velocityDispersion(10 ** 8.12)).toBeCloseTo(200, 4);
    expect(velocityDispersion(1e9)).toBeGreaterThan(velocityDispersion(1e7));
  });

  it('labels the cosmic-web environment by overdensity', () => {
    expect(environmentClass(0.1)).toBe('Void');
    expect(environmentClass(0.4)).toBe('Wall');
    expect(environmentClass(0.6)).toBe('Filament');
    expect(environmentClass(0.9)).toBe('Cluster');
  });

  it('exposes the home galaxy cosmic-web density in [0, 1]', () => {
    const home = makeGalaxy(SEED, 0, 0);
    expect(home?.cosmicDensity).toBeGreaterThanOrEqual(0);
    expect(home?.cosmicDensity).toBeLessThanOrEqual(1);
  });

  it('assigns each galaxy a black-hole spin in [0, 1)', () => {
    for (let gx = 0; gx <= 5; gx++) {
      const g = makeGalaxy(SEED, gx, 0);
      if (g) {
        expect(g.blackHoleSpin).toBeGreaterThanOrEqual(0);
        expect(g.blackHoleSpin).toBeLessThan(1);
      }
    }
  });
});

describe('cosmicDensity & clustering', () => {
  it('is smooth and within [0, 1]', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const c = cosmicDensity(SEED, gx, gy);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    expect(Math.abs(cosmicDensity(SEED, 0, 0) - cosmicDensity(SEED, 1, 0))).toBeLessThan(0.2);
  });

  it('clusters galaxies and skews them spheroidal where the web is dense', () => {
    let denseGal = 0;
    let denseTot = 0;
    let denseSph = 0;
    let voidGal = 0;
    let voidTot = 0;
    for (let gx = -40; gx <= 40; gx++) {
      for (let gy = -40; gy <= 40; gy++) {
        const c = cosmicDensity(SEED, gx, gy);
        const g = makeGalaxy(SEED, gx, gy);
        if (c > 0.6) {
          denseTot++;
          if (g) {
            denseGal++;
            if (g.type === 'elliptical' || g.type === 'lenticular')
              denseSph++;
          }
        }
        else if (c < 0.4) {
          voidTot++;
          if (g)
            voidGal++;
        }
      }
    }
    expect(denseTot).toBeGreaterThan(0);
    expect(voidTot).toBeGreaterThan(0);
    expect(denseGal / denseTot).toBeGreaterThan(voidGal / voidTot);
    expect(denseSph / denseGal).toBeGreaterThan(0.4);
  });
});
