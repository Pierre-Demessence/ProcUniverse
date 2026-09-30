import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { SectorCache } from '../../lod/sector-cache';
import type { SystemStreamer } from '../../lod/streaming';
import type { ThreeBackend } from '../../render/three-backend';
import type { DrawnStar } from '../../render/three/star-sprites';
import type { ThreeRenderer } from '../../render/three/three-renderer';
import type { SelectionState } from '../../selection-state';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { worldToView } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { blendPlaneNormal, GALACTIC_NORMAL } from '../../camera/plane-basis';
import { GALAXY_SPRITE_SCALE } from '../../config/render';
import { BodyVisualDef } from '../../generation/body-visual';
import { layerWeights, SYSTEM_LAYER_REACH_AU } from '../../lod/tier';
import { applyBodyScale } from '../../render/body-scale';
import { drawBodyLabels, drawGalaxyFieldLabels, drawStarLabels } from '../../render/draw-labels';
import { drawSelectReticle } from '../../render/select-reticle';
import { after } from '../pipeline';

/** Reticle radius (px) around a hovered star sprite. */
const STAR_HOVER_RETICLE_PX = 10;

export interface RenderSystemDeps {
  cache: SectorCache;
  camera: Camera;
  canvas: HTMLCanvasElement;
  controller: Pick<CameraController, 'azimuth' | 'focusZ' | 'setSystemPlane' | 'tilt'>;
  ctx2d: CanvasRenderingContext2D;
  seed: number;
  selectionState: Pick<SelectionState, 'select' | 'selection'>;
  state: FrameState;
  streamer: Pick<SystemStreamer, 'status'>;
  threeBackend: Pick<ThreeBackend<ThreeRenderer>, 'renderer'>;
  world: EcsWorld;
}

/**
 * Clears the transparent overlay canvas that sits on top of the Three canvas;
 * labels, the reticle and the HUD redraw on it every frame.
 */
export function makeOverlayClearSystem(deps: Pick<RenderSystemDeps, 'canvas' | 'ctx2d'>): SchedulableSystem<FrameCtx> {
  const { canvas, ctx2d } = deps;
  return {
    name: 'overlay-clear',
    runAfter: after('overlay-clear'),
    run() {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/**
 * Draws the active tier with Three.js and its labels on the overlay. `camera`
 * is already in the render-origin frame; the lock re-centre at the top of the
 * frame set it to the body's local position, so a locked body stays centred.
 * The system and star tiers are one blended 3D render (`ctx.blend`).
 */
export function makeRenderThreeSystem(deps: Pick<RenderSystemDeps, 'cache' | 'camera' | 'controller' | 'ctx2d' | 'seed' | 'state' | 'streamer' | 'threeBackend' | 'world'>): SchedulableSystem<FrameCtx> {
  const { cache, camera, controller, ctx2d, seed, state, streamer, threeBackend, world } = deps;
  const labelScratch: DrawnStar[] = [];
  return {
    name: 'render-three',
    runAfter: after('render-three'),
    runIf: ctx => ctx.threeActive && threeBackend.renderer !== null,
    run(ctx) {
      const three = threeBackend.renderer!;
      const localCam = { ...camera };
      ctx.localCam = localCam;
      const originX = state.renderOriginX;
      const originY = state.renderOriginY;
      if (ctx.tier === 'system' || ctx.tier === 'star') {
        const { blend } = ctx;
        const weights = layerWeights(blend);
        const systemLayer = blend < 1;
        if (ctx.tier === 'system')
          three.updateStarfield(seed, ctx.camAbsX, ctx.camAbsY);
        else
          three.ensureStarfield(seed, ctx.camAbsX, ctx.camAbsY);
        // Floor the body radii for this zoom (shrinking with the cross-fade)
        // before the passes read them.
        if (systemLayer)
          applyBodyScale(world, localCam.zoom, weights.bodies);
        // Anchor the 3D camera + pan to the focused system's orbital plane, so a
        // low tilt reads as a true top-down (orbits as circles) regardless of how
        // the disk is oriented in space; across the cross-fade it swings to the
        // galactic plane, which the star tier orbits around.
        const planeNormal = blendPlaneNormal(ctx.focusedSystem?.diskNormal ?? GALACTIC_NORMAL, blend);
        controller.setSystemPlane(planeNormal[0], planeNormal[1], planeNormal[2]);
        const starsDrawn = three.render({
          azimuth: controller.azimuth,
          blend,
          camera: localCam,
          focusZ: controller.focusZ,
          planeNormal,
          simSeconds: state.simSeconds,
          stars: blend > 0 ? { cache, focused: ctx.focusedSystem, originX, originY, originZ: state.renderOriginZ } : null,
          tilt: controller.tilt,
          world,
        });
        const project = (x: number, y: number, z: number, out: { sx: number; sy: number }): boolean => three.projectToScreen(x, y, z, out);
        if (systemLayer) {
          // Once the far plane reaches the star field, neighbouring systems'
          // bodies are no longer clipped; label only the focused system's.
          const reach2 = SYSTEM_LAYER_REACH_AU * SYSTEM_LAYER_REACH_AU;
          const bodyProject = blend > 0
            ? (x: number, y: number, z: number, out: { sx: number; sy: number }): boolean => x * x + y * y + z * z <= reach2 && project(x, y, z, out)
            : project;
          ctx2d.save();
          ctx2d.globalAlpha = weights.bodies;
          drawBodyLabels(ctx2d, world, bodyProject, localCam.zoom);
          ctx2d.restore();
        }
        if (blend > 0) {
          ctx2d.save();
          ctx2d.globalAlpha = weights.stars;
          drawStarLabels(ctx2d, three.brightestStars(labelScratch), project);
          ctx2d.restore();
        }
        const status = streamer.status();
        state.lastDrawnCount = (systemLayer ? status.stars + status.planets : 0) + starsDrawn;
      }
      else if (ctx.tier === 'galaxy-field') {
        state.lastDrawnCount = three.renderGalaxyField({ camera: localCam, originX, originY, seed });
        drawGalaxyFieldLabels(ctx2d, localCam, seed, originX, originY);
      }
      else if (ctx.tier === 'galaxy') {
        state.lastDrawnCount = three.renderGalaxy({ camera: localCam, originX, originY, seed });
      }
      else {
        state.lastDrawnCount = three.renderUniverse({ camera: localCam, originX, originY, seed });
      }
    },
  };
}

/**
 * Tracks the selected body: clears the selection if it streamed out or the tier
 * left the system view, otherwise draws its reticle at the body's live screen
 * position so it follows an orbiting planet. At the star tier it also marks and
 * names the star under the pointer (a click there flies into that system).
 */
export function makeReticleSystem(deps: Pick<RenderSystemDeps, 'camera' | 'ctx2d' | 'selectionState' | 'state' | 'threeBackend' | 'world'>): SchedulableSystem<FrameCtx> {
  const { camera, ctx2d, selectionState, state, threeBackend, world } = deps;
  const positions = world.getStore(Position3DDef);
  const visuals = world.getStore(BodyVisualDef);
  return {
    name: 'reticle',
    runAfter: after('reticle'),
    run(ctx) {
      const hoverThree = threeBackend.renderer;
      if (ctx.tier === 'star' && ctx.threeActive && hoverThree && state.pointerX !== null && state.pointerY !== null) {
        const star = hoverThree.pickStar(state.pointerX, state.pointerY);
        const p = { sx: 0, sy: 0 };
        if (star && hoverThree.projectToScreen(star.x, star.y, star.z, p)) {
          drawSelectReticle(ctx2d, p.sx, p.sy, STAR_HOVER_RETICLE_PX);
          drawStarLabels(ctx2d, [star], (x, y, z, out) => hoverThree.projectToScreen(x, y, z, out));
        }
      }
      // Read live, not the frame-start selection: a bookmark can resolve earlier
      // in this frame, and a stale selection whose body just streamed out would
      // clear the new one (and its lock).
      const selection = selectionState.selection;
      const localCam = ctx.localCam;
      if (!selection)
        return;
      if (selection.kind === 'galaxy') {
        // A galaxy selection persists across tiers (it may be pinned from the
        // location tree while zoomed in); only its on-canvas reticle is gated to
        // the galaxy-field tier, whose top-down view maps world to screen
        // directly.
        if (ctx.tier === 'galaxy-field' && localCam) {
          const screen = worldToView(selection.galaxy.centerX - state.renderOriginX, selection.galaxy.centerY - state.renderOriginY, localCam);
          drawSelectReticle(ctx2d, screen.vx, screen.vy, selection.galaxy.radius * GALAXY_SPRITE_SCALE * camera.zoom);
        }
        return;
      }
      if (selection.kind === 'universe')
        return;
      const pos = ctx.tier === 'system' ? positions.get(selection.id) : undefined;
      if (!pos) {
        selectionState.select(null);
        return;
      }
      const three = threeBackend.renderer;
      if (!ctx.threeActive || !three)
        return;
      // Project through the perspective camera so the reticle tracks the body
      // once the view is orbited, tilted, or panned off-centre.
      const discRadius = visuals.get(selection.id)?.radius ?? 0;
      const p = { sx: 0, sy: 0 };
      if (three.projectToScreen(pos.x, pos.y, pos.z, p))
        drawSelectReticle(ctx2d, p.sx, p.sy, discRadius * camera.zoom);
    },
  };
}
