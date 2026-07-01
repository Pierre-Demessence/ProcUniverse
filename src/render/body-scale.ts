import type { EcsWorld } from '@pierre/ecs';

import type { BodyScale } from '../settings';

import { clamp } from '@pierre/ecs/modules/math';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';

import {
  BODY_FLOOR_BASE_PX,
  BODY_FLOOR_MAX_PX,
  BODY_FLOOR_MIN_PX,
  BODY_FLOOR_PER_DECADE_PX,
} from '../config/render';
import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { blackHoleVisualRadius, planetVisualRadius, starVisualRadius } from '../scale';
import { bodyScale } from '../settings';

// Stroke widths as a fraction of the drawn radius, mirroring `spawn.ts` so the
// outline / accretion ring stays proportional however the disc is floored.
const STAR_STROKE_FRAC = 0.08;
const BLACK_HOLE_RING_FRAC = 0.4;

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

/**
 * Drawn radius (AU) for a body of true radius `trueAu` at the given `zoom`.
 * `'true'` scale draws the real radius (bodies vanish to sub-pixels when zoomed
 * out); `'usable'` never lets it fall below `bodyFloorPx` on screen, so bodies
 * stay visible as ordered markers and only reach true scale once you zoom in far
 * enough that their real size overtakes the floor.
 */
export function drawnBodyRadiusAu(trueAu: number, zoom: number, mode: BodyScale): number {
  if (mode === 'true')
    return trueAu;
  return Math.max(trueAu, bodyFloorPx(trueAu) / zoom);
}

/**
 * Update every system-tier body's drawn `RenderableDef` radius (and proportional
 * stroke) from the current `zoom` and the `bodyScale` setting, so the shared
 * renderer draws floored-but-still-true-underneath markers. Runs each frame
 * before the entity pass; the true radius is re-derived from each body's physical
 * data, so the data itself is never overwritten. Counts are bounded by the system
 * tier, so a per-body update is cheap.
 */
export function applyBodyScale(world: EcsWorld, zoom: number): void {
  const mode = bodyScale.value;
  const renderables = world.getStore(RenderableDef);
  const stars = world.getStore(StarPhysicalDef);
  const planets = world.getStore(PlanetPhysicalDef);
  const moons = world.getStore(MoonPhysicalDef);
  const blackHoles = world.getStore(BlackHoleDef);

  for (const [id] of world.query(StarPhysicalDef)) {
    const renderable = renderables.get(id);
    const star = stars.get(id);
    if (!renderable || renderable.kind !== 'circle' || !star)
      continue;
    const radius = drawnBodyRadiusAu(starVisualRadius(star.radius), zoom, mode);
    renderable.radius = radius;
    renderable.lineWidth = radius * STAR_STROKE_FRAC;
  }

  for (const [id] of world.query(PlanetPhysicalDef)) {
    const renderable = renderables.get(id);
    const planet = planets.get(id);
    if (!renderable || renderable.kind !== 'circle' || !planet)
      continue;
    renderable.radius = drawnBodyRadiusAu(planetVisualRadius(planet.radius), zoom, mode);
  }

  for (const [id] of world.query(BlackHoleDef)) {
    const renderable = renderables.get(id);
    const blackHole = blackHoles.get(id);
    if (!renderable || renderable.kind !== 'circle' || !blackHole)
      continue;
    const radius = drawnBodyRadiusAu(blackHoleVisualRadius(blackHole.mass), zoom, mode);
    renderable.radius = radius;
    renderable.lineWidth = radius * BLACK_HOLE_RING_FRAC;
  }

  for (const [id] of world.query(MoonPhysicalDef)) {
    const renderable = renderables.get(id);
    const moon = moons.get(id);
    if (!renderable || renderable.kind !== 'circle' || !moon)
      continue;
    renderable.radius = drawnBodyRadiusAu(planetVisualRadius(moon.radius), zoom, mode);
  }
}
