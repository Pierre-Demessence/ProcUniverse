/**
 * Real generated planets for the planet lab to tune against: scans sectors
 * outward from the origin (the home galaxy) with the same pure generator the
 * app streams from, so the lab sees exactly the data a surface will receive.
 */

import type { PlanetPhysical } from '../generation/planets';

import { generateSectorData } from '../generation/universe';

export interface LabPlanet {
  /** Flat colour the app currently draws this planet with. */
  fill: string;
  label: string;
  physical: PlanetPhysical;
}

/** Square-spiral sector coordinates around (0, 0), nearest rings first. */
export function* spiralSectors(maxRing: number): Generator<[number, number]> {
  yield [0, 0];
  for (let r = 1; r <= maxRing; r++) {
    for (let x = -r; x <= r; x++) {
      yield [x, -r];
      yield [x, r];
    }
    for (let y = -r + 1; y <= r - 1; y++) {
      yield [-r, y];
      yield [r, y];
    }
  }
}

/**
 * Collect up to `limit` planets of `seed`'s universe, nearest sectors first,
 * sorted by type then temperature so the picker groups similar worlds.
 */
export function scanPlanets(seed: number, limit: number, maxRing = 40): LabPlanet[] {
  const found: LabPlanet[] = [];
  for (const [sx, sy] of spiralSectors(maxRing)) {
    for (const system of generateSectorData(seed, sx, sy).systems) {
      for (const planet of system.planets) {
        const p = planet.physical;
        found.push({
          fill: planet.color,
          label: `${p.type} · ${Math.round(p.equilibriumTemp)} K · ${planet.name.human}`,
          physical: p,
        });
      }
    }
    if (found.length >= limit)
      break;
  }
  return found
    .slice(0, limit)
    .sort((a, b) => a.physical.type.localeCompare(b.physical.type) || a.physical.equilibriumTemp - b.physical.equilibriumTemp);
}
