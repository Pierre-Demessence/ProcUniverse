import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';

import { worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { BlackHoleDef } from '../generation/galaxies';
import { NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';

const GAP_PX = 6;
const CULL_MARGIN_PX = 64;
const STAR_FONT = '12px ui-monospace, monospace';
const PLANET_FONT = '10px ui-monospace, monospace';
const STAR_COLOR = 'rgba(214, 230, 255, 0.95)';
const PLANET_COLOR = 'rgba(184, 206, 240, 0.72)';
const BLACK_HOLE_COLOR = 'rgba(255, 190, 130, 0.95)';
const SHADOW = 'rgba(2, 4, 10, 0.9)';

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
    ctx2d.fillText(identity.name, v.vx, v.vy + discPx + GAP_PX);
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

  ctx2d.restore();
}
