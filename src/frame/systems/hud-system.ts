import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { FrameStats } from '@pierre/ecs/modules/stats';
import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { Bookmark } from '../../bookmarks';
import type { SectorCache } from '../../lod/sector-cache';
import type { Tier } from '../../lod/tier';
import type { ThreeBackend } from '../../render/three-backend';
import type { ThreeRenderer } from '../../render/three/three-renderer';
import type { SelectionState } from '../../selection-state';
import type { BookmarkList } from '../../ui/bookmark-list';
import type { Inspector } from '../../ui/inspector';
import type { NavTree } from '../../ui/nav-tree';
import type { TimeControls } from '../../ui/time-controls';
import type { FrameCtx } from '../frame-context';
import type { FrameState } from '../frame-state';

import { drawStatsOverlay } from '@pierre/ecs/modules/stats';

import { bookmarkKey, selectionBookmarkKey } from '../../bookmarks';
import { cameraAbsolute } from '../../camera/origin';
import { STATS_HUD_GAP_PX, STATS_HUD_RIGHT_RESERVE_PX, STATS_HUD_TOP_PX, STATS_HUD_WIDTH_PX } from '../../config/render';
import { drawCoords } from '../../render/draw-coords';
import { drawScaleBar } from '../../render/scale-bar';
import { buildNavState } from '../../ui/nav-state';
import { after } from '../pipeline';

const TARGET_MS = 1000 / 60;
const HINT = 'Drag to pan  ·  Scroll to zoom';

export interface HudSystemDeps {
  bookmarkList: Pick<BookmarkList, 'update'>;
  bookmarks: readonly Bookmark[];
  cache: SectorCache;
  camera: Camera;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  frameStats: FrameStats;
  inspector: Pick<Inspector, 'update'>;
  navTree: Pick<NavTree, 'update'>;
  seed: number;
  selectionState: Pick<SelectionState, 'lockedId' | 'selection'>;
  state: FrameState;
  threeBackend: Pick<ThreeBackend<ThreeRenderer>, 'renderer'>;
  timeControls: Pick<TimeControls, 'update'>;
  world: EcsWorld;
}

/**
 * Lightweight HUD overlays and DOM updates, run every frame so the time display
 * and frame-time sparkline stay live.
 */
export function makeHudSystem(deps: HudSystemDeps): SchedulableSystem<FrameCtx> {
  const { bookmarkList, bookmarks, cache, camera, canvas, ctx2d, frameStats, inspector, navTree, seed, selectionState, state, threeBackend, timeControls, world } = deps;
  return {
    name: 'hud',
    runAfter: after('hud'),
    run(ctx) {
      frameStats.setCounter('drawn', state.lastDrawnCount);

      // Re-read: the reticle pass may have cleared the selection.
      const selection = selectionState.selection;
      const selKey = selection ? selectionBookmarkKey(selection, world) : null;
      const bookmarked = selKey !== null && bookmarks.some(b => bookmarkKey(b.kind, b.name) === selKey);
      inspector.update(world, selection, selectionState.lockedId, bookmarked);
      bookmarkList.update(bookmarks);

      // The tree and the coordinate readout want the ABSOLUTE camera position.
      const camAbs = { ...camera, x: cameraAbsolute(state.renderOriginX, camera.x), y: cameraAbsolute(state.renderOriginY, camera.y) };
      navTree.update(buildNavState(seed, cache, camAbs, ctx.tier, world, selection));

      // Perf monitor: top-right, just left of the sim-time panel (so the tree
      // owns the top-left). Knobs are CSS pixels; the overlay draws in backing
      // pixels, hence the dpr scale. The sim-panel reserve and top margin track
      // the DOM sim panel (scaled by dpr); the overlay's own width is intrinsic
      // backing pixels (it renders dpr-independently), so it is subtracted
      // unscaled, keeping the panel snug left of the sim panel at any ratio.
      const dpr = window.devicePixelRatio || 1;
      const statsX = canvas.width - (STATS_HUD_RIGHT_RESERVE_PX + STATS_HUD_GAP_PX) * dpr - STATS_HUD_WIDTH_PX;
      drawStatsOverlay(ctx2d, frameStats, { targetMs: TARGET_MS, x: statsX, y: STATS_HUD_TOP_PX * dpr });
      drawHint(ctx2d, canvas, ctx.tier, `Three (${threeBackend.renderer?.backendLabel ?? '…'})`);
      drawScaleBar(ctx2d, camera);
      drawCoords(ctx2d, camAbs, seed);
      timeControls.update(state.simSeconds);
    },
  };
}

function drawHint(ctx2d: CanvasRenderingContext2D, canvas: HTMLCanvasElement, tier: Tier, rendererLabel: string): void {
  ctx2d.save();
  ctx2d.font = '12px ui-monospace, monospace';
  ctx2d.fillStyle = 'rgba(160, 190, 240, 0.55)';
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'bottom';
  ctx2d.fillText(`${HINT}   ·   tier: ${tier}   ·   renderer: ${rendererLabel}`, 10, canvas.height - 8);
  ctx2d.restore();
}
