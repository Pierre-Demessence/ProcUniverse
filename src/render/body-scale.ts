import type { EcsWorld } from '@pierre/ecs';

import type { BodyScale } from '../settings';

import { clamp } from '@pierre/ecs/modules/math';

import {
  BODY_FLOOR_BASE_PX,
  BODY_FLOOR_MAX_PX,
  BODY_FLOOR_MIN_PX,
  BODY_FLOOR_PER_DECADE_PX,
  MOON_FLOOR_MIN_PX,
} from '../config/render';
import { BodyVisualDef } from '../generation/body-visual';
import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { blackHoleVisualRadius, planetVisualRadius, starVisualRadius } from '../scale';
import { bodyScale } from '../settings';

/**
 * Minimum on-screen radius (px) for a body of true radius `trueAu`. A gentle
 * log map — `BODY_FLOOR_BASE_PX` at 1 AU, ±`BODY_FLOOR_PER_DECADE_PX` per decade,
 * clamped — so bodies stay visible when zoomed out while keeping their real size
 * ordering: it is monotonic, so a bigger body never floors smaller than a
 * smaller one (a Sun's marker ≥ Earth's, a red dwarf ≈ Jupiter as in reality).
 */
export function bodyFloorPx(trueAu: number): number {
  return clamp(
    BODY_FLOOR_BASE_PX + BODY_FLOOR_PER_DECADE_PX * Math.log10(trueAu),
    BODY_FLOOR_MIN_PX,
    BODY_FLOOR_MAX_PX,
  );
}

// Cap the equatorial bulge so extreme fast-rotators squash plausibly rather than
// collapsing toward a disc. Saturn — the most oblate planet — is ~0.098; the cap
// leaves headroom for a visible bulge while keeping the body a spheroid.
export const OBLATENESS_MAX = 0.3;

/**
 * Polar-axis scale (relative to the equatorial radius) for a planet whose
 * rotational flattening is `oblatenessFraction` = (R_eq − R_pol)/R_eq: the
 * sphere is drawn squashed to this fraction along its spin axis. Clamped to
 * `[1 − OBLATENESS_MAX, 1]` so a fast rotator stays a plausible spheroid.
 */
export function oblatePolarScale(oblatenessFraction: number): number {
  return 1 - clamp(oblatenessFraction, 0, OBLATENESS_MAX);
}

/**
 * Drawn radius (AU) for a body of true radius `trueAu` at the given `zoom`.
 * `'true'` scale draws the real radius (bodies vanish to sub-pixels when zoomed
 * out); `'usable'` never lets it fall below its floor on screen, so bodies stay
 * visible as ordered markers and only reach true scale once you zoom in far
 * enough that their real size overtakes the floor. `minFloorPx` raises that floor
 * for a body that would otherwise sit at the base minimum (moons), so it still
 * reads as a distinct marker.
 */
export function drawnBodyRadiusAu(trueAu: number, zoom: number, mode: BodyScale, minFloorPx = BODY_FLOOR_MIN_PX): number {
  if (mode === 'true')
    return trueAu;
  return Math.max(trueAu, Math.max(bodyFloorPx(trueAu), minFloorPx) / zoom);
}

/**
 * Update every system-tier body's drawn `BodyVisualDef` radius from the current
 * `zoom` and the `bodyScale` setting, so the 3D passes draw
 * floored-but-still-true-underneath markers. Runs each frame before the body
 * passes; the true radius is re-derived from each body's physical data, so the
 * data itself is never overwritten. Counts are bounded by the system tier, so a
 * per-body update is cheap.
 */
export function applyBodyScale(world: EcsWorld, zoom: number): void {
  const mode = bodyScale.value;
  const visuals = world.getStore(BodyVisualDef);

  for (const [id, star] of world.query(StarPhysicalDef)) {
    const visual = visuals.get(id);
    if (visual)
      visual.radius = drawnBodyRadiusAu(starVisualRadius(star.radius), zoom, mode);
  }

  for (const [id, planet] of world.query(PlanetPhysicalDef)) {
    const visual = visuals.get(id);
    if (visual)
      visual.radius = drawnBodyRadiusAu(planetVisualRadius(planet.radius), zoom, mode);
  }

  for (const [id, blackHole] of world.query(BlackHoleDef)) {
    const visual = visuals.get(id);
    if (visual)
      visual.radius = drawnBodyRadiusAu(blackHoleVisualRadius(blackHole.mass), zoom, mode);
  }

  for (const [id, moon] of world.query(MoonPhysicalDef)) {
    const visual = visuals.get(id);
    if (visual)
      visual.radius = drawnBodyRadiusAu(planetVisualRadius(moon.radius), zoom, mode, MOON_FLOOR_MIN_PX);
  }
}
