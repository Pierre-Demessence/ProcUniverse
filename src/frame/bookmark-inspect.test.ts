import { EcsWorld } from '@pierre/ecs';
import { makeCamera } from '@pierre/ecs/modules/camera';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { describe, expect, it } from 'vitest';

import { bookmarkFromSelection } from '../bookmarks';
import { frameZoom } from '../camera/focus';
import { FRAME_MARGIN, MAX_ZOOM, MIN_ZOOM, SYSTEM_VIEW_AU } from '../config/render';
import { PlanetPhysicalDef } from '../generation/planets';
import { SectorCache } from '../lod/sector-cache';
import { SystemStreamer } from '../lod/streaming';
import { SelectionState } from '../selection-state';
import { universePlugin } from '../world-plugin';
import { createFrameCtx } from './frame-context';
import { FrameState } from './frame-state';
import { buildFramePipeline } from './pipeline';
import { makeBackendSelectSystem } from './systems/backend-systems';
import { makeChangeDetectSystem, makeLockRecentreSystem, makeSimClockSystem, makeTierSelectSystem } from './systems/view-systems';
import { makeOrbitsSystem, makeOriginRebaseSystem, makePendingBookmarkSystem, makeStreamingSystem } from './systems/world-systems';

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
      makeChangeDetectSystem({ camera, selectionState, state }),
      makeBackendSelectSystem({ controller, flattenButton: { setVisible() {} }, state, threeBackend: { update: () => ({ active: false, changed: false, threeMode: false }) }, wantThree: () => false }),
      makeOriginRebaseSystem({ cache, camera, state, streamer }),
      makeStreamingSystem({ state, streamer, world }),
      makeOrbitsSystem(state, world),
      makePendingBookmarkSystem({ camera, selectionState, world }),
    ].map(s => ({ ...s, runAfter: s.runAfter })));
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
      const pos = sel && 'id' in sel ? world.getStore(PositionDef).get(sel.id) : undefined;
      expect(sel?.kind).toBe('planet');
      expect(camera.zoom).toBeCloseTo(zoomSet);
      // Within a millionth of an AU: the view spans ~1e-3 AU at this zoom.
      expect(camera.x).toBeCloseTo(pos?.x ?? Number.NaN, 6);
      expect(camera.y).toBeCloseTo(pos?.y ?? Number.NaN, 6);
    }
    expect(camera.zoom).toBeCloseTo(zoomSet);
    expect(selectionState.selection?.kind).toBe('planet');
  });
});
