import type { EcsWorld, EntityId } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';

import type { GeneratedName } from '../generation/naming';

import { cameraViewRect, worldToView } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { GALAXY_SPRITE_SCALE } from '../config/render';
import { BlackHoleDef, galaxiesInRect } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { displayName, NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { namingStyle } from '../settings';
import { OrbitElementsDef } from '../sim/orbits';

const GAP_PX = 6;
// Star sprites are wider than a body marker; drop their labels clear of the glow.
const STAR_LABEL_OFFSET_PX = 4;
const STAR_FONT = '12px ui-monospace, monospace';
const PLANET_FONT = '10px ui-monospace, monospace';
const STAR_COLOR = 'rgba(214, 230, 255, 0.95)';
const PLANET_COLOR = 'rgba(184, 206, 240, 0.72)';
const BLACK_HOLE_COLOR = 'rgba(255, 190, 130, 0.95)';
const SHADOW = 'rgba(2, 4, 10, 0.9)';
const MOON_FONT = '9px ui-monospace, monospace';
const MOON_COLOR = 'rgba(170, 192, 224, 0.6)';
// Only label a moon once its orbit is wide enough on screen that the name clears
// its planet; otherwise moon labels pile onto the planet marker at system-zoom.
const MOON_LABEL_MIN_ORBIT_PX = 18;
// A galaxy's catalogue label is drawn once its sprite is at least this wide (px).
const GALAXY_LABEL_MIN_PX = 22;
const GALAXY_LABEL_FILL = 'rgba(210, 224, 255, 0.85)';

/** A star-tier star to label: its name and render-origin-frame position. */
export interface LabelledStar {
  system: { name: GeneratedName };
  x: number;
  y: number;
  z: number;
}

/** Projects a render-origin-frame world point to backing-px screen coords; false if off/behind. */
export type ScreenProjector = (x: number, y: number, z: number, out: { sx: number; sy: number }) => boolean;

/**
 * STAR tier: name the given stars (the brightest few, or the hovered one) just
 * below their projected sprites. Callers set any fade via `globalAlpha`.
 */
export function drawStarLabels(ctx2d: CanvasRenderingContext2D, stars: readonly LabelledStar[], project: ScreenProjector): void {
  if (stars.length === 0)
    return;
  const screen = { sx: 0, sy: 0 };
  ctx2d.save();
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.shadowColor = SHADOW;
  ctx2d.shadowBlur = 3;
  ctx2d.font = STAR_FONT;
  ctx2d.fillStyle = STAR_COLOR;
  for (const star of stars) {
    if (project(star.x, star.y, star.z, screen))
      ctx2d.fillText(displayName(star.system.name, namingStyle.value), screen.sx, screen.sy + GAP_PX + STAR_LABEL_OFFSET_PX);
  }
  ctx2d.restore();
}

/**
 * SYSTEM tier: draw each body's catalogue name just below its projected screen
 * position, so labels track bodies as they orbit and as the view is tilted.
 * Counts are bounded by the system tier, so a per-body draw is cheap.
 */
export function drawBodyLabels(ctx2d: CanvasRenderingContext2D, world: EcsWorld, project: ScreenProjector, zoom: number): void {
  const positions = world.getStore(Position3DDef);
  const names = world.getStore(NameDef);
  const orbits = world.getStore(OrbitElementsDef);
  const screen = { sx: 0, sy: 0 };

  ctx2d.save();
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.shadowColor = SHADOW;
  ctx2d.shadowBlur = 3;

  const label = (id: EntityId): void => {
    const identity = names.get(id);
    const pos = positions.get(id);
    if (!identity || !pos || !project(pos.x, pos.y, pos.z, screen))
      return;
    ctx2d.fillText(displayName(identity, namingStyle.value), screen.sx, screen.sy + GAP_PX);
  };

  ctx2d.font = STAR_FONT;
  ctx2d.fillStyle = STAR_COLOR;
  for (const [id] of world.query(StarPhysicalDef))
    label(id);

  ctx2d.font = PLANET_FONT;
  ctx2d.fillStyle = PLANET_COLOR;
  for (const [id] of world.query(PlanetPhysicalDef))
    label(id);

  ctx2d.font = STAR_FONT;
  ctx2d.fillStyle = BLACK_HOLE_COLOR;
  for (const [id] of world.query(BlackHoleDef))
    label(id);

  ctx2d.font = MOON_FONT;
  ctx2d.fillStyle = MOON_COLOR;
  for (const [id] of world.query(MoonPhysicalDef)) {
    const orbit = orbits.get(id);
    if (!orbit || orbit.a * zoom < MOON_LABEL_MIN_ORBIT_PX)
      continue;
    label(id);
  }

  ctx2d.restore();
}

/**
 * GALAXY-FIELD tier: each galaxy's catalogue name below its glow sprite, once
 * the sprite is wide enough to carry one. The tier's top-down view maps world to
 * screen directly, so `worldToView` places the labels on the Three sprites.
 */
export function drawGalaxyFieldLabels(
  ctx2d: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  originX: number,
  originY: number,
): void {
  const rect = cameraViewRect(cam);
  const minX = rect.x + originX;
  const minY = rect.y + originY;
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = GALAXY_LABEL_FILL;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  for (const g of galaxiesInRect(seed, minX, minY, minX + rect.w, minY + rect.h)) {
    const radiusPx = g.radius * cam.zoom * GALAXY_SPRITE_SCALE;
    if (radiusPx * 2 < GALAXY_LABEL_MIN_PX)
      continue;
    const v = worldToView(g.centerX - originX, g.centerY - originY, cam);
    ctx2d.fillText(namingStyle.value === 'human' ? g.humanName : g.name, v.vx, v.vy + radiusPx + 3);
  }
  ctx2d.restore();
}
