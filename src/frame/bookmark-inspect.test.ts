import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { describe, expect, it } from 'vitest';

import { bookmarkFromSelection } from '../bookmarks';
import { frameZoom } from '../camera/focus';
import { FRAME_MARGIN, MAX_ZOOM, MIN_ZOOM, SYSTEM_VIEW_AU } from '../config/render';
import { NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { SectorCache } from '../lod/sector-cache';
import { SystemStreamer } from '../lod/streaming';
import { SelectionState } from '../selection-state';
import { universePlugin } from '../world-plugin';
import { createFrameCtx } from './frame-context';
import { FrameState } from './frame-state';
import { after, buildFramePipeline } from './pipeline';
import { makeBackendSelectSystem } from './systems/backend-systems';
import { makeReticleSystem } from './systems/render-systems';
import { makeLockRecentreSystem, makeSimClockSystem, makeTierSelectSystem } from './systems/view-systems';
import { makeOrbitsSystem, makeOriginRebaseSystem, makePendingBookmarkSystem, makeStreamingSystem } from './systems/world-systems';

// The reticle draws with a handful of 2D calls; none matter to this test.
const noopCtx2d = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;

describe('bookmark inspect across systems', () => {
  it.each([['from the system tier', 1000 / SYSTEM_VIEW_AU], ['from the star tier', 1e-3]])('keeps the framing zoom and centres on the live planet %s', (_label, startZoom) => {
    const seed = 12345;
    const world = new EcsWorld().use(universePlugin);
    const cache = new SectorCache(seed);
    const streamer = new SystemStreamer(world, cache);
    const camera = makeCamera({ viewportH: 1000, viewportW: 1000, x: 0, y: 0, zoom: 1000 / SYSTEM_VIEW_AU });
    const state = new FrameState({ simSeconds: 0, tier: 'system' });
    const selectionState = new SelectionState();
    const controller = { setFocusZ() {}, setThreeSystemActive() {} };
    const scheduler = buildFramePipeline([
      makeSimClockSystem(state, { timeScale: 1 }, { sample() {} }),
      makeLockRecentreSystem({ camera, controller, selectionState, state, world }),
      makeTierSelectSystem(camera, state),
      makeBackendSelectSystem({ controller, flattenButton: { setVisible() {} }, state, threeBackend: { update: () => false } }),
      makeOriginRebaseSystem({ cache, camera, state, streamer }),
      makeStreamingSystem({ state, streamer, world }),
      makeOrbitsSystem(state, world),
      makePendingBookmarkSystem({ camera, selectionState, world }),
      // Render steps are stubs; the reticle is the real system because it can clear the selection.
      { name: 'overlay-clear', runAfter: after('overlay-clear'), run() {} },
      { name: 'render-three', runAfter: after('render-three'), run() {} },
      makeReticleSystem({ camera, ctx2d: noopCtx2d, selectionState, state, threeBackend: { renderer: null }, world }),
    ]);
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++)
        scheduler.run(createFrameCtx(16, state.currentTier));
    };

    const goTo = (x: number, y: number): void => {
      camera.x = x - state.renderOriginX;
      camera.y = y - state.renderOriginY;
    };
    // Find two systems with planets in different sectors.
    const found: { x: number; y: number }[] = [];
    for (let sx = 0; sx < 60 && found.length < 2; sx++) {
      for (const sys of cache.get(sx, 0).systems) {
        if (sys.planets && sys.planets.length > 0) {
          found.push({ x: sys.x, y: sys.y });
          break;
        }
      }
    }
    expect(found.length).toBe(2);

    goTo(found[0].x, found[0].y);
    tick(3);
    const planets = [...world.query(PlanetPhysicalDef)];
    expect(planets.length).toBeGreaterThan(0);
    const id = planets[0][0];
    const bm = bookmarkFromSelection({ id, kind: 'planet' }, world, state.renderOriginX, state.renderOriginY)!;
    expect(bm).not.toBeNull();

    goTo(found[1].x, found[1].y);
    tick(3);
    camera.zoom = startZoom;
    tick(4);
    // The user has a body selected in the current system when they click Inspect.
    const current = [...world.query(PlanetPhysicalDef)][0]?.[0];
    if (current !== undefined)
      selectionState.select({ id: current, kind: 'planet' });

    // ---- inspect (same logic as main.ts onBookmarkInspect)
    camera.x = bm.x - state.renderOriginX;
    camera.y = bm.y - state.renderOriginY;
    camera.zoom = frameZoom(bm.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
    const zoomSet = camera.zoom;
    const opened = selectionState.openBookmark(bm, world, seed);
    expect(opened).toBeNull();

    for (let i = 0; i < 4; i++) {
      tick();
      const sel = selectionState.selection;
      const pos = sel && 'id' in sel ? world.getStore(Position3DDef).get(sel.id) : undefined;
      expect(sel?.kind).toBe('planet');
      expect(sel && 'id' in sel ? world.getStore(NameDef).get(sel.id)?.scientific : null).toBe(bm.name);
      expect(selectionState.lockedId).not.toBeNull();
      expect(camera.zoom).toBeCloseTo(zoomSet);
      // Within a millionth of an AU: the view spans ~1e-3 AU at this zoom.
      expect(camera.x).toBeCloseTo(pos?.x ?? Number.NaN, 6);
      expect(camera.y).toBeCloseTo(pos?.y ?? Number.NaN, 6);
    }
    expect(camera.zoom).toBeCloseTo(zoomSet);
    expect(selectionState.selection?.kind).toBe('planet');
  });
});
