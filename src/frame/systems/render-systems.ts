import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { CameraController } from '../../camera/camera-controller';
import type { SectorCache } from '../../lod/sector-cache';
import type { SystemStreamer } from '../../lod/streaming';
import type { ThreeBackend } from '../../render/three-backend';
import type { ThreeRenderer } from '../../render/three/three-renderer';
import type { SelectionState } from '../../selection-state';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { worldToView } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';

import { GALAXY_SPRITE_SCALE } from '../../config/render';
import { BodyVisualDef } from '../../generation/body-visual';
import { applyBodyScale } from '../../render/body-scale';
import { drawBodyLabels, drawGalaxyFieldLabels } from '../../render/draw-labels';
import { drawSelectReticle } from '../../render/select-reticle';
import { after } from '../pipeline';

// Fallback orbital-plane normal (world +z) when no system is focused.
const WORLD_PLANE_NORMAL = [0, 0, 1] as const;

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
 */
export function makeRenderThreeSystem(deps: Pick<RenderSystemDeps, 'cache' | 'camera' | 'controller' | 'ctx2d' | 'seed' | 'state' | 'streamer' | 'threeBackend' | 'world'>): SchedulableSystem<FrameCtx> {
  const { cache, camera, controller, ctx2d, seed, state, streamer, threeBackend, world } = deps;
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
      three.updateStarfield(seed, originX, originY, ctx.camAbsX, ctx.camAbsY);
      if (ctx.tier === 'system') {
        // Floor the body radii for this zoom before the passes read them.
        applyBodyScale(world, localCam.zoom);
        // Anchor the 3D camera + pan to the focused system's orbital plane, so a
        // low tilt reads as a true top-down (orbits as circles) regardless of how
        // the disk is oriented in space.
        const planeNormal = ctx.focusedSystem?.diskNormal ?? WORLD_PLANE_NORMAL;
        controller.setSystemPlane(planeNormal[0], planeNormal[1], planeNormal[2]);
        three.render({ azimuth: controller.azimuth, camera: localCam, focusZ: controller.focusZ, planeNormal, simSeconds: state.simSeconds, tilt: controller.tilt, world });
        drawBodyLabels(ctx2d, world, (x, y, z, out) => three.projectToScreen(x, y, z, out), localCam.zoom);
        const status = streamer.status();
        state.lastDrawnCount = status.stars + status.planets;
      }
      else if (ctx.tier === 'star') {
        state.lastDrawnCount = three.renderStars({ cache, camera: localCam, originX, originY, range: ctx.range });
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
 * position so it follows an orbiting planet.
 */
export function makeReticleSystem(deps: Pick<RenderSystemDeps, 'camera' | 'ctx2d' | 'selectionState' | 'state' | 'threeBackend' | 'world'>): SchedulableSystem<FrameCtx> {
  const { camera, ctx2d, selectionState, state, threeBackend, world } = deps;
  const positions = world.getStore(Position3DDef);
  const visuals = world.getStore(BodyVisualDef);
  return {
    name: 'reticle',
    runAfter: after('reticle'),
    run(ctx) {
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
