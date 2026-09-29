import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Canvas2DRenderContext } from '@pierre/ecs/modules/render-canvas2d';
import type { Renderer } from '@pierre/ecs/renderer';
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
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';

import { GALAXY_SPRITE_SCALE, TIER_FADE_MS } from '../../config/render';
import { drawBodyLabels3D } from '../../render/draw-labels';
import { renderFrame } from '../../render/scene';
import { drawSelectReticle } from '../../render/select-reticle';
import { PositionZDef } from '../../sim/orbits';
import { after } from '../pipeline';

// Fallback orbital-plane normal (world +z) when no system is focused.
const WORLD_PLANE_NORMAL = [0, 0, 1] as const;

export interface RenderSystemDeps {
  cache: SectorCache;
  camera: Camera;
  canvas: HTMLCanvasElement;
  controller: Pick<CameraController, 'azimuth' | 'focusZ' | 'setSystemPlane' | 'tilt'>;
  ctx2d: CanvasRenderingContext2D;
  fadeCanvas: HTMLCanvasElement;
  fadeCtx: CanvasRenderingContext2D;
  renderer: Renderer<Canvas2DRenderContext>;
  sceneCache: HTMLCanvasElement;
  sceneCacheCtx: CanvasRenderingContext2D;
  seed: number;
  selectionState: Pick<SelectionState, 'select'>;
  state: FrameState;
  streamer: Pick<SystemStreamer, 'status'>;
  threeBackend: Pick<ThreeBackend<ThreeRenderer>, 'renderer'>;
  world: EcsWorld;
}

/**
 * Captures the previous frame to cross-fade out of on a tier change, but only
 * when the cache is valid, i.e. the canvas still holds a good prior frame (not a
 * blank startup canvas or one a resize just cleared).
 */
export function makeFadeCaptureSystem(deps: Pick<RenderSystemDeps, 'canvas' | 'fadeCanvas' | 'fadeCtx' | 'state'>): SchedulableSystem<FrameCtx> {
  const { canvas, fadeCanvas, fadeCtx, state } = deps;
  return {
    name: 'fade-capture',
    runAfter: after('fade-capture'),
    run(ctx) {
      if (!ctx.dirty || !ctx.tierChanged || !state.sceneCacheValid || ctx.threeActive)
        return;
      fadeCtx.clearRect(0, 0, fadeCanvas.width, fadeCanvas.height);
      fadeCtx.drawImage(canvas, 0, 0);
      state.fadeMsLeft = TIER_FADE_MS;
    },
  };
}

/**
 * Composes the Canvas 2D frame. `camera.x/y` are already the offset from the
 * render origin, so the camera doubles as the render-frame camera with no
 * huge − huge subtraction; the lock re-centre at the top of the frame set it to
 * the body's local position, so a locked body stays exactly centred.
 */
export function makeRenderSceneSystem(deps: Pick<RenderSystemDeps, 'cache' | 'camera' | 'canvas' | 'ctx2d' | 'renderer' | 'seed' | 'state' | 'world'>): SchedulableSystem<FrameCtx> {
  const { cache, camera, canvas, ctx2d, renderer, seed, state, world } = deps;
  return {
    name: 'render-scene',
    runAfter: after('render-scene'),
    run(ctx) {
      if (!ctx.dirty)
        return;
      ctx.localCam = { ...camera };
      ctx.renderResult = renderFrame({
        cache,
        camera: ctx.localCam,
        canvas,
        ctx2d,
        originX: state.renderOriginX,
        originY: state.renderOriginY,
        range: ctx.range,
        renderer,
        seed,
        threeMode: ctx.threeMode || ctx.threeActive,
        tier: ctx.tier,
        world,
      });
    },
  };
}

/**
 * Draws the Three.js tiers onto the renderer's own canvas behind the
 * transparent 2D canvas. `render-scene` has already run `applyBodyScale`, so the
 * system bodies' radii are floored before Three reads them; the other tiers read
 * their data directly and return their own drawn count.
 */
export function makeRenderThreeSystem(deps: Pick<RenderSystemDeps, 'cache' | 'controller' | 'ctx2d' | 'seed' | 'state' | 'threeBackend' | 'world'>): SchedulableSystem<FrameCtx> {
  const { cache, controller, ctx2d, seed, state, threeBackend, world } = deps;
  return {
    name: 'render-three',
    runAfter: after('render-three'),
    run(ctx) {
      const three = threeBackend.renderer;
      const localCam = ctx.localCam;
      if (!ctx.dirty || !ctx.threeActive || !three || !localCam)
        return;
      const originX = state.renderOriginX;
      const originY = state.renderOriginY;
      three.updateStarfield(seed, originX, originY, ctx.camAbsX, ctx.camAbsY);
      if (ctx.tier === 'system') {
        // Anchor the 3D camera + pan to the focused system's orbital plane, so a
        // low tilt reads as a true top-down (orbits as circles) regardless of how
        // the disk is oriented in space.
        const planeNormal = ctx.focusedSystem?.diskNormal ?? WORLD_PLANE_NORMAL;
        controller.setSystemPlane(planeNormal[0], planeNormal[1], planeNormal[2]);
        three.render({ azimuth: controller.azimuth, camera: localCam, focusZ: controller.focusZ, planeNormal, simSeconds: state.simSeconds, tilt: controller.tilt, world });
        drawBodyLabels3D(ctx2d, world, (x, y, z, out) => three.projectToScreen(x, y, z, out), localCam.zoom);
        ctx.renderedByThree = true;
      }
      else if (ctx.tier === 'star') {
        ctx.renderResult = three.renderStars({ cache, camera: localCam, originX, originY, range: ctx.range });
        ctx.renderedByThree = true;
      }
      else if (ctx.tier === 'galaxy-field') {
        ctx.renderResult = three.renderGalaxyField({ camera: localCam, originX, originY, seed });
        ctx.renderedByThree = true;
      }
      else if (ctx.tier === 'galaxy') {
        ctx.renderResult = three.renderGalaxy({ camera: localCam, originX, originY, seed });
        ctx.renderedByThree = true;
      }
      else if (ctx.tier === 'universe') {
        ctx.renderResult = three.renderUniverse({ camera: localCam, originX, originY, seed });
        ctx.renderedByThree = true;
      }
    },
  };
}

/** Blends the captured old-tier frame over the new one. */
export function makeCrossFadeSystem(deps: Pick<RenderSystemDeps, 'ctx2d' | 'fadeCanvas' | 'state'>): SchedulableSystem<FrameCtx> {
  const { ctx2d, fadeCanvas, state } = deps;
  return {
    name: 'cross-fade',
    runAfter: after('cross-fade'),
    run(ctx) {
      if (!ctx.dirty || state.fadeMsLeft <= 0)
        return;
      ctx2d.save();
      ctx2d.globalAlpha = Math.min(1, state.fadeMsLeft / TIER_FADE_MS);
      ctx2d.drawImage(fadeCanvas, 0, 0);
      ctx2d.restore();
      state.fadeMsLeft -= ctx.dtMs;
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
  const positions = world.getStore(PositionDef);
  const renderables = world.getStore(RenderableDef);
  return {
    name: 'reticle',
    runAfter: after('reticle'),
    run(ctx) {
      const selection = ctx.selection;
      const localCam = ctx.localCam;
      if (!ctx.dirty || !selection || !localCam)
        return;
      if (selection.kind === 'galaxy') {
        // A galaxy selection persists across tiers (it may be pinned from the
        // location tree while zoomed in); only its on-canvas reticle is gated to
        // the galaxy-field tier where galaxies are discrete sprites.
        if (ctx.tier === 'galaxy-field') {
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
      const renderable = renderables.get(selection.id);
      const discRadius = renderable?.kind === 'circle' ? renderable.radius : 0;
      const three = threeBackend.renderer;
      if (ctx.threeActive && three) {
        // Project through the perspective camera so the reticle tracks the body
        // once the view is orbited, tilted, or panned off-centre.
        const p = { sx: 0, sy: 0 };
        const pz = world.getStore(PositionZDef).get(selection.id)?.z ?? 0;
        if (three.projectToScreen(pos.x, pos.y, pz, p))
          drawSelectReticle(ctx2d, p.sx, p.sy, discRadius * camera.zoom);
      }
      else {
        const screen = worldToView(pos.x, pos.y, localCam);
        drawSelectReticle(ctx2d, screen.vx, screen.vy, discRadius * camera.zoom);
      }
    },
  };
}

/**
 * Snapshots the fully-composed scene (background + content + reticle +
 * cross-fade, but no overlays) so clean frames can blit it back and only redraw
 * the cheap HUD on top. Skipped in Three mode: the scene lives on the Three
 * canvas and every frame is dirty, so copying the full-resolution canvas each
 * frame would be pure overhead.
 */
export function makeSceneCacheSystem(deps: Pick<RenderSystemDeps, 'canvas' | 'ctx2d' | 'sceneCache' | 'sceneCacheCtx' | 'state' | 'streamer'>): SchedulableSystem<FrameCtx> {
  const { canvas, ctx2d, sceneCache, sceneCacheCtx, state, streamer } = deps;
  return {
    name: 'scene-cache',
    runAfter: after('scene-cache'),
    run(ctx) {
      if (!ctx.dirty) {
        if (state.sceneCacheValid) {
          ctx2d.clearRect(0, 0, canvas.width, canvas.height);
          ctx2d.drawImage(sceneCache, 0, 0);
        }
        return;
      }
      const status = streamer.status();
      state.lastDrawnCount = ctx.renderResult < 0 ? status.stars + status.planets : ctx.renderResult;
      if (ctx.threeActive) {
        state.sceneCacheValid = false;
        return;
      }
      sceneCacheCtx.clearRect(0, 0, sceneCache.width, sceneCache.height);
      sceneCacheCtx.drawImage(canvas, 0, 0);
      state.sceneCacheValid = true;
    },
  };
}
