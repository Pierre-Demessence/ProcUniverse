import type { Bookmark } from './bookmarks';
import type { FrameCtx } from './frame/frame-context';
import type { SystemData } from './generation/universe';
import type { Save } from './persistence/save';
import type { ThreeRenderer } from './render/three/three-renderer';
import type { NavNode } from './ui/nav-tree';

import { EcsWorld } from '@pierre/ecs';
import { projectPointer } from '@pierre/ecs/modules/input';
import { clamp } from '@pierre/ecs/modules/math';
import { FrameStats } from '@pierre/ecs/modules/stats';
import { AnimationFrameTickSource } from '@pierre/ecs/modules/tick';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { TickRunner } from '@pierre/ecs/tick-runner';

import { bookmarkZ, removeBookmark, toggleBookmark } from './bookmarks';
import { createCameraController } from './camera/camera-controller';
import { frameZoom } from './camera/focus';
import { frameSelection } from './camera/framing';
import { cameraAbsolute } from './camera/origin';
import { CLICK_SLOP_PX, DISC_FRAME_FACTOR, FRAME_MARGIN, MAX_ZOOM, MIN_ZOOM, SYSTEM_VIEW_AU } from './config/render';
import { createFrameCtx } from './frame/frame-context';
import { FrameState } from './frame/frame-state';
import { buildFramePipeline } from './frame/pipeline';
import { makeBackendSelectSystem } from './frame/systems/backend-systems';
import { makeHudSystem } from './frame/systems/hud-system';
import { makeOverlayClearSystem, makeRenderThreeSystem, makeReticleSystem } from './frame/systems/render-systems';
import { makeLockRecentreSystem, makeSimClockSystem, makeTierSelectSystem } from './frame/systems/view-systems';
import { makeOrbitsSystem, makeOriginRebaseSystem, makePendingBookmarkSystem, makeStreamingSystem } from './frame/systems/world-systems';
import { galaxyAt } from './generation/galaxies';
import { SectorCache } from './lod/sector-cache';
import { SystemStreamer } from './lod/streaming';
import { selectTier } from './lod/tier';
import { writeSave } from './persistence/save';
import { findEntityByName, pickGalaxyAt } from './pick';
import { ThreeBackend } from './render/three-backend';
import { SECTOR_SIZE } from './scale';
import { SelectionState } from './selection-state';
import { createBookmarkList } from './ui/bookmark-list';
import { createFlattenButton } from './ui/flatten-button';
import { createInspector } from './ui/inspector';
import { createNavTree } from './ui/nav-tree';
import { createOptionsMenu } from './ui/options';
import { showRenderFailure } from './ui/render-failure';
import { createResetViewButton } from './ui/reset-view';
import { createTimeControls } from './ui/time-controls';
import { universePlugin } from './world-plugin';

/**
 * App entry. Wires the ECS world, the LOD tier system (sector streaming at the
 * system tier; instanced star points and galaxy-density glows when zoomed out),
 * the camera, the Three.js renderer with its 2D overlay, and the rAF loop.
 */
export function start(container: HTMLElement, save: Save): () => void {
  container.innerHTML = '';
  const { seed } = save;
  const state = new FrameState({ simSeconds: save.simSeconds, tier: 'system' });
  const bookmarks: Bookmark[] = [...save.bookmarks];
  const persistBookmarks = (): void => {
    save.bookmarks = bookmarks;
    writeSave(save);
  };

  // Transparent overlay above the Three canvas: labels, reticle and HUD draw
  // here, and it receives the pointer input.
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; inset:0; display:block; width:100%; height:100%; touch-action:none; cursor:grab;';
  container.append(canvas);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d)
    throw new Error('ProcUniverse: 2D canvas context is unavailable.');

  // Three.js renderer: a lazy chunk, so the page shell and HUD appear before it
  // downloads; mounted behind the overlay canvas.
  const threeBackend = new ThreeBackend<ThreeRenderer>(
    () => import('./render/three/three-renderer').then(({ ThreeRenderer }) => {
      const r = new ThreeRenderer();
      r.resize(canvas.width, canvas.height);
      return r;
    }),
    (r) => {
      container.insertBefore(r.canvas, canvas);
    },
    () => showRenderFailure(container),
  );

  // Size the backing store to device pixels before the camera is created, so it
  // reads real dimensions rather than the canvas default (300x150).
  const sizeCanvas = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    threeBackend.resize(canvas.width, canvas.height);
  };
  sizeCanvas();

  const controller = createCameraController(canvas);
  const timeControls = createTimeControls(container, save.speedIndex);

  const world = new EcsWorld().use(universePlugin);

  const positions = world.getStore(Position3DDef);

  // Deterministic universe: sectors are generated on demand and cached; the
  // streamer spawns/despawns full systems for the sectors in view at the system
  // tier.
  const cache = new SectorCache(seed);
  const streamer = new SystemStreamer(world, cache);

  const frameStats = new FrameStats();

  // Keep the camera viewport equal to the canvas backing size so the renderer's
  // view and the pointer math share a single coordinate space.
  const syncViewport = (): void => {
    sizeCanvas();
    controller.camera.viewportW = canvas.width;
    controller.camera.viewportH = canvas.height;
  };
  syncViewport();

  // The origin view frames the home galaxy's centre (its central black hole);
  // fall back to the first system or the sector centre if absent. Captured as a
  // reusable framing so startup and the "return to origin" button agree.
  const homeGalaxy = galaxyAt(seed, 0, 0);
  const originSector = cache.get(0, 0);
  const homeFocus = homeGalaxy
    ? { x: homeGalaxy.centerX, y: homeGalaxy.centerY }
    : originSector.systems.length > 0
      ? originSector.systems[0]
      : { x: SECTOR_SIZE / 2, y: SECTOR_SIZE / 2 };

  // Floating render origin. The camera position is stored as a SMALL OFFSET from
  // this origin (`camera.x/y`), not as an absolute coordinate, so pan/zoom deltas
  // never fall below the float64 ULP however far the camera travels; the absolute
  // position is `renderOrigin + camera.x`. The origin snaps to the focused star at
  // the system tier (for GPU float32 precision) and to the sector grid otherwise,
  // rebased as the local offset grows.

  const frameOrigin = (): void => {
    state.renderOriginX = Math.round(homeFocus.x / SECTOR_SIZE) * SECTOR_SIZE;
    state.renderOriginY = Math.round(homeFocus.y / SECTOR_SIZE) * SECTOR_SIZE;
    state.renderOriginZ = 0;
    controller.camera.x = homeFocus.x - state.renderOriginX;
    controller.camera.y = homeFocus.y - state.renderOriginY;
    controller.camera.zoom = canvas.height / SYSTEM_VIEW_AU;
  };

  // Resume the saved view from a previous visit, or frame the origin on a first
  // visit. The saved view is absolute; anchor the origin to it and store the
  // small offset. A persisted zoom is clamped in case the config bounds changed.
  // The 3D orbit state (azimuth, tilt, focusZ) is also restored so the camera
  // direction and focus height survive a reload; the origin starts on the
  // galactic plane (z = 0), so the saved absolute focus height is the local one.
  const savedView = save.view;
  if (savedView) {
    state.renderOriginX = Math.round(savedView.x / SECTOR_SIZE) * SECTOR_SIZE;
    state.renderOriginY = Math.round(savedView.y / SECTOR_SIZE) * SECTOR_SIZE;
    controller.camera.x = savedView.x - state.renderOriginX;
    controller.camera.y = savedView.y - state.renderOriginY;
    controller.camera.zoom = clamp(savedView.zoom, MIN_ZOOM, MAX_ZOOM);
    controller.restoreOrbit(savedView.azimuth, savedView.tilt, savedView.focusZ);
  }
  else {
    frameOrigin();
  }

  const resizeObserver = new ResizeObserver(syncViewport);
  resizeObserver.observe(container);

  // A container ResizeObserver does not fire when only devicePixelRatio changes
  // (e.g. dragging the window to a different-DPI monitor), which would leave the
  // canvas blurry. Re-sync on each DPR change and re-arm the watcher.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    syncViewport();
    watchDpr();
  };
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  }
  watchDpr();

  const { camera } = controller;
  // Initialise to the restored view's tier (not a hardcoded 'system') so tier
  // hysteresis starts from where the view actually is.
  state.currentTier = selectTier(camera, 'system');

  // Body selection (system tier only). A pointer gesture is treated as a pick
  // only when it barely moved — a real drag pans the view and never selects.
  // Escape and empty-space clicks clear the selection; the render loop clears it
  // when the body streams out or the tier changes.
  const selectionState = new SelectionState();
  let pointerDownX = 0;
  let pointerDownY = 0;
  // Armed when a pointerdown starts while locked — the first move beyond
  // CLICK_SLOP_PX releases the lock so the re-centre doesn't fight the pan.
  let lockDragArmed = false;

  // The 3D camera's look-at height (z) lives in the controller
  // (`controller.focusZ`): the 3D pan moves it, locking sets it to the body's
  // out-of-plane z, and Return-to-origin resets it. It is retained on unlock so
  // the view never snaps back to the ground plane and loses the body.

  const onZoomTo = (): void => {
    const selection = selectionState.selection;
    if (!selection)
      return;
    const frame = frameSelection(selection, world, camera, state.renderOriginX, state.renderOriginY, state.renderOriginZ);
    if (frame)
      controller.setFocusZ(frame.z);
    // Pin a planet / moon so it stays centred — in x, y and out-of-plane z — as
    // it orbits; static bodies (star / galaxy / black hole) need no lock. The
    // per-frame lock re-centre also supplies the 3D camera's focus height, so a
    // tilted view frames the body itself rather than its z=0 projection.
    selectionState.lockSelectedOrbiter();
  };

  const onToggleBookmark = (): void => {
    const selection = selectionState.selection;
    if (selection && toggleBookmark(bookmarks, selection, world, state.renderOriginX, state.renderOriginY, state.renderOriginZ))
      persistBookmarks();
  };

  const inspector = createInspector(container, { onToggleBookmark, onZoomTo, onToggleLock: () => selectionState.toggleLock() });

  const onPickDown = (e: PointerEvent): void => {
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    // Only a left-button (pan) drag breaks a lock; right-drag orbits around it.
    lockDragArmed = selectionState.lockedId !== null && e.button === 0;
  };
  const onLockPointerMove = (e: PointerEvent): void => {
    if (!lockDragArmed || selectionState.lockedId === null)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX) {
      selectionState.unlock();
      lockDragArmed = false;
    }
  };
  const onPickUp = (e: PointerEvent): void => {
    lockDragArmed = false;
    // Only a left-button release is a pick; right-drag orbits the 3D view.
    if (e.button !== 0)
      return;
    // Ignore releases over the HUD panels (tree / inspector / time): those are
    // their own clicks, not a canvas pick that should re-select or clear.
    if (e.target !== canvas)
      return;
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_SLOP_PX)
      return;
    const { x: bx, y: by } = projectPointer(e, canvas);
    // `camera` is already in the render-origin frame, so it doubles as localCam.
    const localCam = { ...camera };
    if (state.currentTier === 'system') {
      const three = threeBackend.renderer;
      if (threeBackend.active && three)
        selectionState.select(three.pickAt(bx, by));
    }
    else if (state.currentTier === 'star') {
      const star = threeBackend.active ? threeBackend.renderer?.pickStar(bx, by) : null;
      if (star)
        onStarInspect(star.system);
    }
    else if (state.currentTier === 'galaxy-field') {
      const galaxy = pickGalaxyAt(seed, localCam, state.renderOriginX, state.renderOriginY, bx, by);
      selectionState.select(galaxy ? { galaxy, kind: 'galaxy' } : null);
    }
  };
  const onPickKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape')
      selectionState.select(null);
  };
  // Star-tier hover: the reticle step marks and names the star under the pointer.
  const onHoverMove = (e: PointerEvent): void => {
    const { x, y } = projectPointer(e, canvas);
    state.pointerX = x;
    state.pointerY = y;
  };
  const onHoverLeave = (): void => {
    state.pointerX = null;
    state.pointerY = null;
  };
  canvas.addEventListener('pointermove', onHoverMove);
  canvas.addEventListener('pointerleave', onHoverLeave);
  // In the 3D star view the wheel zooms toward the star (or plane point) under
  // the cursor in all three axes, so zooming onto a star lands in its system.
  controller.setZoomTargetResolver((bx, by) => {
    const three = threeBackend.renderer;
    return state.currentTier === 'star' && threeBackend.active && three ? three.zoomTargetAt(bx, by) : null;
  });
  canvas.addEventListener('pointerdown', onPickDown);
  window.addEventListener('pointermove', onLockPointerMove);
  window.addEventListener('pointerup', onPickUp);
  window.addEventListener('keydown', onPickKey);

  // Location tree (top-left): clicking a body node pins it in the inspector,
  // resolving the streamed entity by its unique catalogue name. Galaxy nodes
  // recompute the galaxy under the camera; the Universe node is not selectable.
  // Double-clicking any node also zooms the camera to frame it.
  const navTree = createNavTree(container, {
    onDoubleClick(): void {
      onZoomTo();
    },
    onSelect(node: NavNode): void {
      if (node.kind === 'universe') {
        selectionState.select({ kind: 'universe', seed });
      }
      else if (node.kind === 'galaxy') {
        const g = galaxyAt(seed, cameraAbsolute(state.renderOriginX, camera.x), cameraAbsolute(state.renderOriginY, camera.y));
        selectionState.select(g ? { galaxy: g, kind: 'galaxy' } : null);
      }
      else if (node.kind === 'star' || node.kind === 'planet' || node.kind === 'moon') {
        const id = findEntityByName(world, node.name);
        if (id !== null)
          selectionState.select({ id, kind: node.kind });
      }
    },
  });

  // Bottom-centre control to snap the camera back to the origin framing after
  // panning far across the universe.
  const onResetView = (): void => {
    selectionState.unlock();
    selectionState.cancelPending();
    controller.resetOrbit();
    frameOrigin();
  };
  const resetViewButton = createResetViewButton(container, { onReset: onResetView });

  // Contextual flatten toggle: only shown inside a system, where snapping the tilted orbit view straight down the disk is meaningful.
  const flattenButton = createFlattenButton(container, { onToggle: isFlat => controller.setFlat(isFlat) });

  // Top-centre options menu for display preferences (units, etc.).
  const optionsMenu = createOptionsMenu(container);

  // Inspect a bookmarked body: zoom to its system (so it streams in if needed)
  // and open the inspector. For orbiting bodies (planets, moons) the bookmarked
  // position is stale, so the camera re-centres on the live position once the
  // entity is streamed (immediately, or via the pending resolution).
  const onBookmarkInspect = (bm: Bookmark): void => {
    camera.x = bm.x - state.renderOriginX;
    camera.y = bm.y - state.renderOriginY;
    controller.setFocusZ(bookmarkZ(bm, cache) - state.renderOriginZ);
    camera.zoom = frameZoom(bm.extentAu, camera.viewportW, camera.viewportH, FRAME_MARGIN, MIN_ZOOM, MAX_ZOOM);
    const id = selectionState.openBookmark(bm, world, seed);
    const pos = id === null ? undefined : positions.get(id);
    if (pos) {
      camera.x = pos.x;
      camera.y = pos.y;
      controller.setFocusZ(pos.z);
    }
  };

  // A click on a star at the star tier flies into its system and selects the
  // star, through the same path as a star bookmark (it resolves once streamed).
  function onStarInspect(sys: SystemData): void {
    let extentAu = sys.radius * DISC_FRAME_FACTOR;
    for (const planet of sys.planets)
      extentAu = Math.max(extentAu, planet.a * (1 + planet.e));
    onBookmarkInspect({ name: sys.name.scientific, extentAu, kind: 'star', label: sys.name.human, x: sys.x, y: sys.y, z: sys.z });
  }

  const onBookmarkRemove = (bm: Bookmark): void => {
    if (removeBookmark(bookmarks, bm))
      persistBookmarks();
  };

  const bookmarkList = createBookmarkList(container, {
    onInspect: onBookmarkInspect,
    onRemove: onBookmarkRemove,
  });

  const scheduler = buildFramePipeline([
    makeSimClockSystem(state, timeControls, frameStats),
    makeLockRecentreSystem({ camera, controller, selectionState, state, world }),
    makeTierSelectSystem(camera, state),
    makeBackendSelectSystem({ camera, controller, flattenButton, state, threeBackend }),
    makeOriginRebaseSystem({ cache, camera, controller, state, streamer }),
    makeStreamingSystem({ state, streamer, world }),
    makeOrbitsSystem(state, world),
    makePendingBookmarkSystem({ camera, controller, selectionState, world }),
    makeOverlayClearSystem({ canvas, ctx2d }),
    makeRenderThreeSystem({ cache, camera, controller, ctx2d, seed, state, streamer, threeBackend, world }),
    makeReticleSystem({ camera, ctx2d, selectionState, state, threeBackend, world }),
    makeHudSystem({ bookmarkList, bookmarks, camera, canvas, ctx2d, frameStats, inspector, navTree, seed, selectionState, state, threeBackend, timeControls, world }),
  ]);
  const runner = new TickRunner<FrameCtx>({
    scheduler,
    source: new AnimationFrameTickSource(),
    contextFactory: info => createFrameCtx(info.deltaMs ?? 0, state.currentTier),
    getWorld: () => world,
  });
  runner.start();

  return (): void => {
    // Persist the final session state (camera, clock, speed) so the next visit
    // resumes here; this teardown is wired to `beforeunload`.
    writeSave({ ...save, simSeconds: state.simSeconds, speedIndex: timeControls.speedIndex, view: { azimuth: controller.azimuth, focusZ: cameraAbsolute(state.renderOriginZ, controller.focusZ), tilt: controller.tilt, x: cameraAbsolute(state.renderOriginX, camera.x), y: cameraAbsolute(state.renderOriginY, camera.y), zoom: camera.zoom } });
    runner.stop();
    resizeObserver.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    canvas.removeEventListener('pointerdown', onPickDown);
    window.removeEventListener('pointermove', onLockPointerMove);
    window.removeEventListener('pointerup', onPickUp);
    window.removeEventListener('keydown', onPickKey);
    canvas.removeEventListener('pointermove', onHoverMove);
    canvas.removeEventListener('pointerleave', onHoverLeave);
    controller.dispose();
    timeControls.dispose();
    inspector.dispose();
    navTree.dispose();
    bookmarkList.dispose();
    resetViewButton.dispose();
    flattenButton.dispose();
    optionsMenu.dispose();
    threeBackend.dispose();
  };
}
