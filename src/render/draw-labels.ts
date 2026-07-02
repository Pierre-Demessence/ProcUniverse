import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';

import { worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { BlackHoleDef } from '../generation/galaxies';
import { MoonPhysicalDef } from '../generation/moons';
import { displayName, NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { namingStyle } from '../settings';
import { OrbitElementsDef } from '../sim/orbits';

const GAP_PX = 6;
const CULL_MARGIN_PX = 64;
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

/**
 * SYSTEM tier: draw each body's catalogue name just below its disc, in screen
 * space, so the label tracks the body — planets carry their name along their
 * orbit. Drawn after the entity pass (and the orbit rings) so labels sit on top.
 * `cam` is in the floating render-origin frame, matching entity positions.
 * Counts are bounded by the system tier, so a per-body draw is cheap.
 */
export function drawBodyLabels(ctx2d: CanvasRenderingContext2D, cam: Camera, world: EcsWorld): void {
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  const names = world.getStore(NameDef);
  const orbits = world.getStore(OrbitElementsDef);

  ctx2d.save();
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.shadowColor = SHADOW;
  ctx2d.shadowBlur = 3;

  const label = (id: number): void => {
    const identity = names.get(id);
    const pos = positions.get(id);
    if (!identity || !pos)
      return;
    const v = worldToView(pos.x, pos.y, cam);
    if (v.vx < -CULL_MARGIN_PX || v.vx > cam.viewportW + CULL_MARGIN_PX
      || v.vy < -CULL_MARGIN_PX || v.vy > cam.viewportH + CULL_MARGIN_PX) {
      return;
    }
    const renderable = renderables.get(id);
    const discPx = renderable?.kind === 'circle' ? renderable.radius * cam.zoom : 0;
    ctx2d.fillText(displayName(identity, namingStyle.value), v.vx, v.vy + discPx + GAP_PX);
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

  // Moons: only once the orbit separates them from the planet on screen, so the
  // names don't pile onto the planet marker at system-zoom.
  ctx2d.font = MOON_FONT;
  ctx2d.fillStyle = MOON_COLOR;
  for (const [id] of world.query(MoonPhysicalDef)) {
    const orbit = orbits.get(id);
    if (!orbit || orbit.a * cam.zoom < MOON_LABEL_MIN_ORBIT_PX)
      continue;
    label(id);
  }

  ctx2d.restore();
}

/** Projects a render-origin-frame world point to backing-px screen coords; false if off/behind. */
export type ScreenProjector = (x: number, y: number, z: number, out: { sx: number; sy: number }) => boolean;

/**
 * SYSTEM tier (3D / Three backend): draw each body's catalogue name at its
 * projected screen position via the perspective camera's `project`. Mirrors
 * `drawBodyLabels` but projects through the 3D camera instead of `worldToView`,
 * so labels track bodies when the view is tilted.
 */
export function drawBodyLabels3D(ctx2d: CanvasRenderingContext2D, world: EcsWorld, project: ScreenProjector, zoom: number): void {
  const positions = world.getStore(PositionDef);
  const names = world.getStore(NameDef);
  const orbits = world.getStore(OrbitElementsDef);
  const screen = { sx: 0, sy: 0 };

  ctx2d.save();
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.shadowColor = SHADOW;
  ctx2d.shadowBlur = 3;

  const label = (id: number): void => {
    const identity = names.get(id);
    const pos = positions.get(id);
    if (!identity || !pos || !project(pos.x, pos.y, 0, screen))
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
