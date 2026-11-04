import type { GalaxyParams } from './galaxies';

import { describe, expect, it } from 'vitest';

import { BLACK_HOLE_MASS_MAX, BLACK_HOLE_MASS_MIN, GALAXY_CELL_LY, GALAXY_SCALE_LENGTH_LY } from '../config/data';
import { SECTOR_SIZE } from '../scale';
import {
  blackHoleMassFromSize,
  cosmicDensity,
  eddingtonLuminosity,
  environmentClass,
  estimatedStarCount,
  evaporationTime,
  galaxiesInBox,
  GALAXY_MAX_RADIUS_AU,
  galaxyActivityAt,
  galaxyActivityOf,
  galaxyAt,
  galaxyCenteredIn,
  galaxyDensityAt,
  galaxyDensityBound,
  galaxyDensityBoundAt,
  galaxyDensityOf,
  galaxyDiameterLy,
  galaxyInCell,
  galaxyRepresentativeActivity,
  galaxySampleAt,
  galaxyStellarMass,
  gasFraction,
  hawkingTemperature,
  innermostStableOrbit,
  isActiveGalacticNucleus,
  makeGalaxy,
  meanStellarAge,
  photonSphere,
  shadowDiameter,
  starFormationRate,
  universeAge,
  velocityDispersion,
} from './galaxies';
import { AU_PER_LY } from './units';

const SEED = 1337;

const spiral: GalaxyParams = {
  name: 'NGC-TEST0',
  arms: 2,
  armStrength: 0.7,
  axisU: [1, 0, 0],
  axisV: [0, 1, 0],
  blackHoleEddingtonRatio: 0.01,
  blackHoleMass: 1e7,
  blackHoleSpin: 0.5,
  centerX: 1000,
  centerY: 1000,
  centerZ: 1000,
  cosmicDensity: 0.5,
  diskNormal: [0, 0, 1],
  dwarf: false,
  ellipticity: 1,
  flattening: 1,
  humanName: 'Testo',
  orientation: 0,
  phase: 0,
  pitch: (18 * Math.PI) / 180,
  radius: 1000,
  scaleHeight: 30,
  scaleLength: 300,
  schwarzschildRadius: 0.2,
  type: 'spiral',
};
const elliptical: GalaxyParams = { ...spiral, ellipticity: 0.6, flattening: 0.4, type: 'elliptical' };

describe('galaxyDensityOf', () => {
  it('peaks at the core and vanishes beyond the radius', () => {
    expect(galaxyDensityOf(spiral, 1000, 1000, 1000)).toBe(1);
    expect(galaxyDensityOf(spiral, 3000, 1000, 1000)).toBe(0);
    expect(galaxyDensityOf(spiral, 1000, 3000, 1000)).toBe(0);
  });

  it('falls off with distance from the core', () => {
    expect(galaxyDensityOf(spiral, 1100, 1000, 1000)).toBeGreaterThan(galaxyDensityOf(spiral, 1600, 1000, 1000));
  });

  it('stays within [0, 1] across the disc', () => {
    for (let dx = -1000; dx <= 1000; dx += 137) {
      for (let dy = -1000; dy <= 1000; dy += 137) {
        const d = galaxyDensityOf(spiral, 1000 + dx, 1000 + dy, 1000);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('squashes an elliptical galaxy along its minor axis', () => {
    expect(galaxyDensityOf(elliptical, 1300, 1000, 1000)).toBeGreaterThan(galaxyDensityOf(elliptical, 1000, 1300, 1000));
  });
});

describe('galaxyActivityOf', () => {
  it('is low and uniform for an elliptical (old, red population)', () => {
    const a = galaxyActivityOf(elliptical, 1300, 1000, 1000);
    expect(a).toBe(galaxyActivityOf(elliptical, 1000, 1300, 1000));
    expect(a).toBeLessThan(0.2);
  });

  it('varies across a spiral and rises above the quiescent baseline on arms', () => {
    const baseline = galaxyActivityOf(elliptical, 1300, 1000, 1000);
    let maxA = 0;
    let minA = 1;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const a = galaxyActivityOf(spiral, 1000 + 300 * Math.cos(rad), 1000 + 300 * Math.sin(rad), 1000);
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
    const home = makeGalaxy(SEED, 0, 0, 0);
    expect(home).not.toBeNull();
    if (home) {
      expect(home.centerX).toBe(0);
      expect(home.centerY).toBe(0);
    }
  });

  it('is deterministic per cell and leaves some cells empty', () => {
    expect(makeGalaxy(SEED, 3, 5, 0)).toEqual(makeGalaxy(SEED, 3, 5, 0));
    let nulls = 0;
    let filled = 0;
    for (let gx = -4; gx <= 4; gx++) {
      for (let gy = -4; gy <= 4; gy++) {
        if (makeGalaxy(SEED, gx, gy, 0))
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
        expect(makeGalaxy(SEED, gx, gy, 0)).toEqual(makeGalaxy(SEED, gx, gy, 0));
    }
  });

  it('draws several morphologies across the grid', () => {
    const types = new Set<string>();
    for (let gx = -10; gx <= 10; gx++) {
      for (let gy = -10; gy <= 10; gy++) {
        const g = makeGalaxy(SEED, gx, gy, 0);
        if (g)
          types.add(g.type);
      }
    }
    expect(types.size).toBeGreaterThanOrEqual(3);
  });
});

describe('galaxyInCell cache', () => {
  it('matches makeGalaxy for near, negative and beyond-key-range cells', () => {
    for (const [gx, gy, gz] of [[0, 0, 0], [3, -7, 2], [-12, 5, -4], [2 ** 16, 1, 0], [-1, 0, -(2 ** 16) - 3]] as const)
      expect(galaxyInCell(SEED, gx, gy, gz)).toEqual(makeGalaxy(SEED, gx, gy, gz));
  });

  it('keeps cells whose coordinates would alias under a naive key apart', () => {
    for (const [gx, gy, gz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0], [0, 0, -1], [-1, 2 ** 16 - 1, 0], [0, -1, 2 ** 16 - 1]] as const)
      expect(galaxyInCell(SEED, gx, gy, gz)).toEqual(makeGalaxy(SEED, gx, gy, gz));
  });

  it('never serves a cached galaxy for another seed', () => {
    const other = SEED + 1;
    for (let gx = 1; gx <= 6; gx++) {
      expect(galaxyInCell(SEED, gx, 2, 0)).toEqual(makeGalaxy(SEED, gx, 2, 0));
      expect(galaxyInCell(other, gx, 2, 0)).toEqual(makeGalaxy(other, gx, 2, 0));
    }
  });
});

describe('galaxyAt / galaxyDensityAt / galaxyCenteredIn', () => {
  it('finds the home galaxy at the origin', () => {
    expect(galaxyDensityAt(SEED, 0, 0, 0)).toBeCloseTo(1, 5);
    expect(galaxyAt(SEED, 0, 0, 0)?.centerX).toBe(0);
  });

  it('returns nothing in an empty cell far from any galaxy', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    let empty: [number, number] | null = null;
    for (let gx = 1; gx <= 30 && !empty; gx++) {
      for (let gy = 0; gy <= 30 && !empty; gy++) {
        if (!makeGalaxy(SEED, gx, gy, 0))
          empty = [gx, gy];
      }
    }
    expect(empty).not.toBeNull();
    if (empty) {
      const x = (empty[0] + 0.5) * cell;
      const y = (empty[1] + 0.5) * cell;
      expect(galaxyDensityAt(SEED, x, y, 0)).toBe(0);
      expect(galaxyAt(SEED, x, y, 0)).toBeNull();
    }
  });

  it('reports a galaxy centre inside its own sector box only', () => {
    expect(galaxyCenteredIn(SEED, 0, 0, 0, SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE)?.centerX).toBe(0);
    expect(galaxyCenteredIn(SEED, 7 * SECTOR_SIZE, 0, 0, 8 * SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE)).toBeNull();
    expect(galaxyCenteredIn(SEED, 0, 0, SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE, 2 * SECTOR_SIZE)).toBeNull();
  });

  it('galaxySampleAt matches galaxyDensityAt and galaxyActivityAt, including the void', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const points: [number, number][] = [[0, 0], [5000 * AU_PER_LY, 2000 * AU_PER_LY], [30000 * AU_PER_LY, -12000 * AU_PER_LY], [0.5 * cell, 0.5 * cell]];
    for (const [x, y] of points) {
      expect(galaxySampleAt(SEED, x, y, 0)).toEqual({ activity: galaxyActivityAt(SEED, x, y, 0), density: galaxyDensityAt(SEED, x, y, 0) });
    }
  });
});

describe('galaxy-field helpers', () => {
  it('reports a positive diameter and a star estimate that grows with size', () => {
    expect(galaxyDiameterLy(spiral)).toBeGreaterThan(0);
    // A realistically-sized galaxy (scale length in light-years), since the star
    // estimate is per-sector and a toy-sized disc rounds to zero at this scale.
    const real = { ...spiral, scaleLength: GALAXY_SCALE_LENGTH_LY * AU_PER_LY };
    const big = { ...real, scaleLength: real.scaleLength * 2 };
    expect(estimatedStarCount(real)).toBeGreaterThan(0);
    expect(estimatedStarCount(big)).toBeGreaterThan(estimatedStarCount(real));
  });

  it('colours spirals younger (bluer) than spheroidals', () => {
    expect(galaxyRepresentativeActivity(spiral)).toBeGreaterThan(galaxyRepresentativeActivity(elliptical));
  });

  it('bounds every galaxy radius by GALAXY_MAX_RADIUS_AU', () => {
    let maxRadius = 0;
    for (let gx = -6; gx <= 6; gx++) {
      for (let gy = -6; gy <= 6; gy++) {
        const g = galaxyInCell(SEED, gx, gy, gx - gy);
        if (g)
          maxRadius = Math.max(maxRadius, g.radius);
      }
    }
    expect(maxRadius).toBeGreaterThan(0);
    expect(maxRadius).toBeLessThanOrEqual(GALAXY_MAX_RADIUS_AU);
  });

  it('iterates galaxies overlapping a box, including the home galaxy', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const found = [...galaxiesInBox(SEED, -cell, -cell, -cell, cell, cell, cell)];
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
    const home = makeGalaxy(SEED, 0, 0, 0);
    expect(home?.cosmicDensity).toBeGreaterThanOrEqual(0);
    expect(home?.cosmicDensity).toBeLessThanOrEqual(1);
  });

  it('assigns each galaxy a black-hole spin in [0, 1)', () => {
    for (let gx = 0; gx <= 5; gx++) {
      const g = makeGalaxy(SEED, gx, 0, 0);
      if (g) {
        expect(g.blackHoleSpin).toBeGreaterThanOrEqual(0);
        expect(g.blackHoleSpin).toBeLessThan(1);
      }
    }
  });
});

describe('galaxy population stats', () => {
  it('gives spirals a higher SFR and gas fraction, and a younger mean age, than ellipticals', () => {
    // Realistically-sized galaxies so the per-sector star estimate (and the SFR
    // that scales from it) is non-zero at the interstellar sector scale.
    const realScale = GALAXY_SCALE_LENGTH_LY * AU_PER_LY;
    const realSpiral = { ...spiral, scaleHeight: realScale / 10, scaleLength: realScale };
    const realElliptical = { ...elliptical, scaleLength: realScale };
    expect(starFormationRate(realSpiral)).toBeGreaterThan(starFormationRate(realElliptical));
    expect(gasFraction(spiral)).toBeGreaterThan(gasFraction(elliptical));
    expect(meanStellarAge(spiral)).toBeLessThan(meanStellarAge(elliptical));
    expect(galaxyStellarMass(realSpiral)).toBeGreaterThan(0);
  });
});

describe('black-hole accretion', () => {
  it('flags an AGN only above the Eddington threshold', () => {
    expect(isActiveGalacticNucleus(0.5)).toBe(true);
    expect(isActiveGalacticNucleus(1e-4)).toBe(false);
  });

  it('assigns each galaxy an Eddington ratio in (0, 1]', () => {
    for (let gx = 0; gx <= 5; gx++) {
      const g = makeGalaxy(SEED, gx, 0, 0);
      if (g) {
        expect(g.blackHoleEddingtonRatio).toBeGreaterThan(0);
        expect(g.blackHoleEddingtonRatio).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('universeAge', () => {
  it('is deterministic per seed, within 8-18 Gyr, and varies by seed', () => {
    expect(universeAge(SEED)).toBe(universeAge(SEED));
    expect(universeAge(SEED)).toBeGreaterThanOrEqual(8e9);
    expect(universeAge(SEED)).toBeLessThanOrEqual(18e9);
    const ages = new Set([universeAge(1), universeAge(2), universeAge(3), universeAge(4)].map(a => Math.round(a / 1e8)));
    expect(ages.size).toBeGreaterThan(1);
  });
});

describe('cosmicDensity & clustering', () => {
  it('is smooth and within [0, 1]', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const c = cosmicDensity(SEED, gx, gy, 0);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    expect(Math.abs(cosmicDensity(SEED, 0, 0, 0) - cosmicDensity(SEED, 1, 0, 0))).toBeLessThan(0.2);
  });

  it('clusters galaxies and skews them spheroidal where the web is dense', () => {
    let denseGal = 0;
    let denseTot = 0;
    let denseSph = 0;
    let voidGal = 0;
    let voidTot = 0;
    for (let gx = -40; gx <= 40; gx++) {
      for (let gy = -40; gy <= 40; gy++) {
        const c = cosmicDensity(SEED, gx, gy, 0);
        const g = makeGalaxy(SEED, gx, gy, 0);
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

describe('3D galaxy structure', () => {
  const barred: GalaxyParams = { ...spiral, type: 'barred-spiral' };
  const lenticular: GalaxyParams = { ...spiral, scaleHeight: 60, type: 'lenticular' };
  // The fixture spiral with its disk turned edge-on: pole along +x.
  const edgeOn: GalaxyParams = { ...spiral, axisU: [0, 1, 0], axisV: [0, 0, 1], diskNormal: [1, 0, 0] };

  it('thins the disk above and below the mid-plane, symmetrically', () => {
    const inPlane = galaxyDensityOf(spiral, 1500, 1000, 1000);
    const above = galaxyDensityOf(spiral, 1500, 1000, 1000 + 3 * spiral.scaleHeight);
    expect(above).toBeLessThan(inPlane * 0.1);
    expect(galaxyDensityOf(spiral, 1500, 1000, 1000 - 3 * spiral.scaleHeight)).toBeCloseTo(above, 12);
  });

  it('follows the disk normal, not the world axes', () => {
    // The edge-on galaxy's major axis is world y and its pole world x: the same
    // in-galaxy point, so the same density, sits along a different world axis.
    expect(galaxyDensityOf(edgeOn, 1000, 1500, 1000)).toBeCloseTo(galaxyDensityOf(spiral, 1500, 1000, 1000), 12);
    expect(galaxyDensityOf(edgeOn, 1500, 1000, 1000)).toBeLessThan(galaxyDensityOf(edgeOn, 1000, 1500, 1000) * 0.1);
  });

  it('keeps a faint halo above the disk where the disk has vanished', () => {
    const high = galaxyDensityOf(spiral, 1000, 1000, 1000 + 20 * spiral.scaleHeight);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(0.2);
  });

  it('squashes an elliptical along all three axes', () => {
    const alongMajor = galaxyDensityOf(elliptical, 1300, 1000, 1000);
    const alongMinor = galaxyDensityOf(elliptical, 1000, 1300, 1000);
    const alongPole = galaxyDensityOf(elliptical, 1000, 1000, 1300);
    expect(alongMajor).toBeGreaterThan(alongMinor);
    expect(alongMinor).toBeGreaterThan(alongPole);
  });

  it('bounds the density everywhere inside the ball it is asked about', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const g of [spiral, barred, lenticular, elliptical, edgeOn]) {
      for (let k = 0; k < 200; k++) {
        const cx = 1000 + (rand() - 0.5) * 2400;
        const cy = 1000 + (rand() - 0.5) * 2400;
        const cz = 1000 + (rand() - 0.5) * 600;
        const reach = rand() * 200;
        const bound = galaxyDensityBound(g, cx, cy, cz, reach);
        for (let j = 0; j < 10; j++) {
          const dx = rand() - 0.5;
          const dy = rand() - 0.5;
          const dz = rand() - 0.5;
          const scale = (reach * rand()) / Math.max(1e-9, Math.hypot(dx, dy, dz));
          expect(galaxyDensityOf(g, cx + dx * scale, cy + dy * scale, cz + dz * scale)).toBeLessThanOrEqual(bound + 1e-12);
        }
      }
    }
  });

  it('bounds the seeded density field too, and is zero in the void', () => {
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const reach = 3 * AU_PER_LY;
    for (const [x, y, z] of [[0, 0, 0], [8000 * AU_PER_LY, 3000 * AU_PER_LY, 400 * AU_PER_LY]] as const)
      expect(galaxyDensityBoundAt(SEED, x, y, z, reach)).toBeGreaterThanOrEqual(galaxyDensityAt(SEED, x + reach / 2, y, z));
    let empty: [number, number] | null = null;
    for (let gx = 1; gx <= 30 && !empty; gx++) {
      if (!makeGalaxy(SEED, gx, 0, 0) && !makeGalaxy(SEED, gx, 0, -1))
        empty = [gx, 0];
    }
    expect(empty).not.toBeNull();
    if (empty)
      expect(galaxyDensityBoundAt(SEED, (empty[0] + 0.5) * cell, 0.5 * cell, 0.5 * cell, reach)).toBe(0);
  });

  it('gives the home galaxy a +z pole and every galaxy an orthonormal frame inside its cell', () => {
    const home = makeGalaxy(SEED, 0, 0, 0);
    expect(home?.diskNormal).toEqual([0, 0, 1]);
    expect(home?.centerZ).toBe(0);
    const cell = GALAXY_CELL_LY * AU_PER_LY;
    const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let checked = 0;
    for (let gz = -2; gz <= 2; gz++) {
      for (let gx = -2; gx <= 2; gx++) {
        const g = makeGalaxy(SEED, gx, 1, gz);
        if (!g)
          continue;
        checked++;
        expect(g.centerZ).toBeGreaterThanOrEqual(gz * cell);
        expect(g.centerZ).toBeLessThan((gz + 1) * cell);
        for (const v of [g.axisU, g.axisV, g.diskNormal])
          expect(dot(v, v)).toBeCloseTo(1, 9);
        expect(dot(g.axisU, g.axisV)).toBeCloseTo(0, 9);
        expect(dot(g.axisU, g.diskNormal)).toBeCloseTo(0, 9);
        expect(dot(g.axisV, g.diskNormal)).toBeCloseTo(0, 9);
        expect(g.scaleHeight).toBeGreaterThan(0);
        expect(g.flattening).toBeLessThanOrEqual(g.ellipticity);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('varies the cosmic web smoothly along z', () => {
    for (let gz = -5; gz <= 5; gz++) {
      const c = cosmicDensity(SEED, 2, 3, gz);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(Math.abs(cosmicDensity(SEED, 2, 3, gz + 1) - c)).toBeLessThan(0.2);
    }
  });
});
