/**
 * Camera framing for a selection: where to centre and how much to show so a
 * body is framed together with whatever orbits it, plus the live position a
 * Lock follows. Coordinates are render-origin-local AU.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { Selection } from '../pick';

import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { DISC_FRAME_FACTOR, FRAME_MARGIN, GALAXY_SPRITE_SCALE, MAX_ZOOM, MIN_ZOOM } from '../config/render';
import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { SECONDS_PER_YEAR } from '../generation/units';
import { blackHoleVisualRadius, planetVisualRadius, starVisualRadius } from '../scale';
import { OrbitElementsDef, writeOrbitPosition } from '../sim/orbits';
import { frameZoom } from './focus';

/** A framing target: render-origin-local centre (AU) and the radius to fit (AU). */
export interface Frame {
  extentAu: number;
  x: number;
  y: number;
}

/** The largest apoapsis among planets directly orbiting a star at the given position. */
function starSatelliteApoapsis(world: EcsWorld, starPosX: number, starPosY: number): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent < 0 && Math.hypot(orbit.cx - starPosX, orbit.cy - starPosY) < 1e-6)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/** The largest apoapsis among moons orbiting a given planet. */
function planetSatelliteApoapsis(world: EcsWorld, planetId: EntityId): number {
  let max = 0;
  for (const [, orbit] of world.query(OrbitElementsDef)) {
    if (orbit.parent === planetId)
      max = Math.max(max, orbit.a * (1 + orbit.e));
  }
  return max;
}

/**
 * The frame for a selection: the larger of the outermost satellite apoapsis and
 * `DISC_FRAME_FACTOR × disc radius`, so a satellite-less body still gets a
 * comfortable framing. Null for the universe or a body that streamed out.
 */
export function selectionFrame(sel: Selection, world: EcsWorld, originX: number, originY: number): Frame | null {
  if (sel.kind === 'universe')
    return null;
  if (sel.kind === 'galaxy') {
    return {
      extentAu: sel.galaxy.radius * GALAXY_SPRITE_SCALE,
      x: sel.galaxy.centerX - originX,
      y: sel.galaxy.centerY - originY,
    };
  }

  const pos = world.getStore(Position3DDef).get(sel.id);
  if (!pos)
    return null;

  let discRadiusAu: number;
  let satelliteExtent = 0;
  if (sel.kind === 'star') {
    const star = world.getStore(StarPhysicalDef).get(sel.id);
    if (!star)
      return null;
    discRadiusAu = starVisualRadius(star.radius);
    satelliteExtent = starSatelliteApoapsis(world, pos.x, pos.y);
  }
  else if (sel.kind === 'planet') {
    const planet = world.getStore(PlanetPhysicalDef).get(sel.id);
    if (!planet)
      return null;
    discRadiusAu = planetVisualRadius(planet.radius);
    satelliteExtent = planetSatelliteApoapsis(world, sel.id);
  }
  else if (sel.kind === 'moon') {
    const moon = world.getStore(MoonPhysicalDef).get(sel.id);
    if (!moon)
      return null;
    discRadiusAu = planetVisualRadius(moon.radius);
  }
  else {
    const bh = world.getStore(BlackHoleDef).get(sel.id);
    if (!bh)
      return null;
    discRadiusAu = blackHoleVisualRadius(bh.mass);
  }

  return { extentAu: Math.max(satelliteExtent, discRadiusAu * DISC_FRAME_FACTOR), x: pos.x, y: pos.y };
}

/** Pan and zoom the camera to the selection's frame; a no-op when there is none. */
export function frameSelection(sel: Selection, world: EcsWorld, camera: Camera, originX: number, originY: number): void {
  const frame = selectionFrame(sel, world, originX, originY);
  if (!frame)
    return;
  camera.zoom = frameZoom(frame.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
  camera.x = frame.x;
  camera.y = frame.y;
}

/**
 * Re-derive a body's position in the render-origin frame from the pure orbit
 * solver so Lock stays glued at any time scale (no one-frame lag) and without
 * round-tripping through absolute coordinates. Returns null when the entity or
 * its parent orbit has streamed out.
 */
export function lockedBodyLocalPos(world: EcsWorld, id: EntityId, simSeconds: number): { x: number; y: number; z: number } | null {
  const orbit = world.getStore(OrbitElementsDef).get(id);
  if (!orbit)
    return null;
  const years = simSeconds / SECONDS_PER_YEAR;
  const out = { x: 0, y: 0, z: 0 };
  if (orbit.parent < 0) {
    writeOrbitPosition(orbit, years, out);
  }
  else {
    const parentOrbit = world.getStore(OrbitElementsDef).get(orbit.parent);
    if (!parentOrbit)
      return null;
    const planetPos = { x: 0, y: 0, z: 0 };
    writeOrbitPosition(parentOrbit, years, planetPos);
    writeOrbitPosition({ ...orbit, cx: planetPos.x, cy: planetPos.y, cz: planetPos.z }, years, out);
  }
  return out;
}
