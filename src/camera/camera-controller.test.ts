// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { FLAT_TILT, MAX_ZOOM, MIN_ZOOM, ORBIT_SENSITIVITY, TILT_DEFAULT, WHEEL_MAX_NOTCHES, WHEEL_NOTCH_PX, ZOOM_STEP, ZOOM_STEP_MAX } from '../config/render';
import { createCameraController, wheelNotches } from './camera-controller';
import { blendPlaneNormal, GALACTIC_NORMAL, planeBasis } from './plane-basis';

const TAU = 2 * Math.PI;

// jsdom has no layout, so client coordinates are backing pixels.
function setup() {
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  const controller = createCameraController(canvas);
  return { canvas, controller };
}

/** Drag from (0, 0) to (dx, dy) with the given button (0 pans, 2 orbits). */
function drag(canvas: HTMLCanvasElement, button: number, dx: number, dy: number): void {
  canvas.dispatchEvent(new PointerEvent('pointerdown', { button, clientX: 0, clientY: 0, pointerId: 1 }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { button, clientX: dx, clientY: dy, pointerId: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { button, clientX: dx, clientY: dy, pointerId: 1 }));
}

function wheel(canvas: HTMLCanvasElement, deltaY: number): void {
  canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 10, clientY: 10, deltaY }));
}

describe('camera controller orbit', () => {
  it('spins the azimuth with horizontal drag and tilts with vertical drag, wrapping the tilt to one turn', () => {
    const { canvas, controller } = setup();
    controller.restoreOrbit(0, 0, 0);
    drag(canvas, 2, 100, 50);
    expect(controller.azimuth).toBeCloseTo(100 * ORBIT_SENSITIVITY);
    expect(controller.tilt).toBeCloseTo(50 * ORBIT_SENSITIVITY);
    // Over the pole and round: the tilt stays in [0, 2π).
    drag(canvas, 2, 0, -100);
    expect(controller.tilt).toBeGreaterThanOrEqual(0);
    expect(controller.tilt).toBeLessThan(TAU);
    expect(controller.tilt).toBeCloseTo(TAU - 50 * ORBIT_SENSITIVITY);
    controller.dispose();
  });

  it('restores a saved orbit, falling back to the default tilt and a zero height for bad numbers', () => {
    const { controller } = setup();
    controller.restoreOrbit(1.2, 0.8, 55);
    expect(controller.azimuth).toBe(1.2);
    expect(controller.tilt).toBeCloseTo(0.8);
    expect(controller.focusZ).toBe(55);
    controller.restoreOrbit(0, Number.NaN, Number.NaN);
    expect(controller.tilt).toBeCloseTo(TILT_DEFAULT);
    expect(controller.focusZ).toBe(0);
    controller.resetOrbit();
    expect([controller.azimuth, controller.tilt, controller.focusZ]).toEqual([0, TILT_DEFAULT, 0]);
    controller.dispose();
  });

  it('reports a straight-down tilt while flat, ignores tilt drags, and restores the stored tilt afterwards', () => {
    const { canvas, controller } = setup();
    controller.restoreOrbit(0, 0.9, 0);
    controller.setFlat(true);
    expect(controller.flat).toBe(true);
    expect(controller.tilt).toBe(FLAT_TILT);
    drag(canvas, 2, 40, 80);
    expect(controller.tilt).toBe(FLAT_TILT);
    // Horizontal drag still pivots the view.
    expect(controller.azimuth).toBeCloseTo(40 * ORBIT_SENSITIVITY);
    controller.setFlat(false);
    expect(controller.tilt).toBeCloseTo(0.9);
    controller.dispose();
  });
});

describe('camera controller pan', () => {
  it('slides the focus along the reference plane, following the cursor at any tier', () => {
    const { canvas, controller } = setup();
    controller.camera.zoom = 2;
    controller.restoreOrbit(0, 0, 0);
    // Looking straight down +z: screen-right is the basis' v axis, screen-up its −u axis.
    const { u, v } = planeBasis(GALACTIC_NORMAL);
    drag(canvas, 0, 10, 0);
    expect(controller.camera.x).toBeCloseTo(-5 * v[0]);
    expect(controller.camera.y).toBeCloseTo(-5 * v[1]);
    expect(controller.focusZ).toBeCloseTo(-5 * v[2]);
    drag(canvas, 0, 0, 10);
    // Dragging down moves the focus up the screen (content follows the cursor).
    expect(controller.camera.x).toBeCloseTo(-5 * v[0] - 5 * u[0]);
    expect(controller.camera.y).toBeCloseTo(-5 * v[1] - 5 * u[1]);
    controller.dispose();
  });

  it('pans in the plane of a tilted reference normal, not in world x, y', () => {
    const { canvas, controller } = setup();
    controller.camera.zoom = 1;
    controller.restoreOrbit(0, 0, 0);
    const normal = blendPlaneNormal(GALACTIC_NORMAL, [1, 0, 0], 1);
    controller.setReferencePlane(...normal);
    const { v } = planeBasis(normal);
    drag(canvas, 0, 20, 0);
    // Straight down the normal, a horizontal drag moves the focus along the in-plane axis v.
    expect(controller.camera.x).toBeCloseTo(-20 * v[0]);
    expect(controller.camera.y).toBeCloseTo(-20 * v[1]);
    expect(controller.focusZ).toBeCloseTo(-20 * v[2]);
    // The focus stays in the reference plane through the origin.
    const along = controller.camera.x * normal[0] + controller.camera.y * normal[1] + controller.focusZ * normal[2];
    expect(along).toBeCloseTo(0);
    controller.dispose();
  });
});

describe('wheelNotches', () => {
  it('counts the scroll in mouse notches, positive zooming in, whatever the delta mode', () => {
    expect(wheelNotches(-WHEEL_NOTCH_PX, 0)).toBe(1);
    expect(wheelNotches(WHEEL_NOTCH_PX, 0)).toBe(-1);
    expect(wheelNotches(-5, 0)).toBeCloseTo(0.05);
    expect(wheelNotches(-3, 1)).toBe(1); // a Firefox notch: three lines
    expect(wheelNotches(1, 2)).toBe(-WHEEL_MAX_NOTCHES); // a page
    expect(wheelNotches(-10 * WHEEL_NOTCH_PX, 0)).toBe(WHEEL_MAX_NOTCHES);
    expect(wheelNotches(0, 0) === 0).toBe(true);
  });
});

describe('camera controller 3D zoom-to-point', () => {
  it('closes the focus in on the resolved target in x, y and z', () => {
    const { canvas, controller } = setup();
    const { camera } = controller;
    camera.x = 100;
    camera.y = -50;
    controller.setFocusZ(40);
    const target = { x: 0, y: 0, z: 1000 };
    controller.setZoomTargetResolver(() => target);
    const before = camera.zoom;
    wheel(canvas, -1);
    const keep = before / camera.zoom;
    expect(keep).toBeLessThan(1);
    expect(camera.x).toBeCloseTo(target.x + 100 * keep);
    expect(camera.y).toBeCloseTo(target.y - 50 * keep);
    expect(controller.focusZ).toBeCloseTo(target.z + (40 - target.z) * keep);
    controller.dispose();
  });

  it('zooms back out from the target, moving the focus away from it', () => {
    const { canvas, controller } = setup();
    const { camera } = controller;
    camera.x = 10;
    controller.setZoomTargetResolver(() => ({ x: 0, y: 0, z: 0 }));
    wheel(canvas, 1);
    expect(camera.x).toBeGreaterThan(10);
    controller.dispose();
  });

  it('zooms about the focus, leaving it in place, when the resolver has no target', () => {
    const { canvas, controller } = setup();
    controller.camera.x = 7;
    controller.camera.y = 8;
    controller.setFocusZ(40);
    controller.setZoomTargetResolver(() => null);
    const before = controller.camera.zoom;
    wheel(canvas, -1);
    expect(controller.camera.zoom).toBeGreaterThan(before);
    expect([controller.camera.x, controller.camera.y, controller.focusZ]).toEqual([7, 8, 40]);
    controller.dispose();
  });

  it('zooms one mouse notch by exactly the base step', () => {
    const { canvas, controller } = setup();
    controller.setZoomTargetResolver(() => null);
    controller.camera.zoom = 1;
    wheel(canvas, -WHEEL_NOTCH_PX);
    expect(controller.camera.zoom).toBeCloseTo(ZOOM_STEP, 12);
    controller.dispose();
  });

  it('adds a trackpad\'s many small events up to the distance scrolled instead of a notch each', () => {
    const { canvas, controller } = setup();
    controller.setZoomTargetResolver(() => null);
    controller.camera.zoom = 1;
    // One second of two-finger scrolling: 60 events of 5 px, 3 notches' worth.
    for (let i = 0; i < 60; i++)
      wheel(canvas, -5);
    // Three notches with the streak ramp stay a modest zoom (it used to be
    // 60 full notches ramping to x2.5 each, ~10^17).
    expect(controller.camera.zoom).toBeGreaterThan(ZOOM_STEP ** 3 * 0.999);
    expect(controller.camera.zoom).toBeLessThan(ZOOM_STEP_MAX ** 3);
    controller.dispose();
  });

  it('ignores a horizontal-only swipe instead of zooming out', () => {
    const { canvas, controller } = setup();
    controller.camera.zoom = 1;
    canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 10, clientY: 10, deltaX: 40, deltaY: 0 }));
    expect(controller.camera.zoom).toBe(1);
    controller.dispose();
  });

  it('follows a trackpad pinch one to one: scale = exp(−deltaY / 100)', () => {
    const { canvas, controller } = setup();
    controller.setZoomTargetResolver(() => null);
    controller.camera.zoom = 1;
    canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 10, clientY: 10, ctrlKey: true, deltaY: -20 }));
    expect(controller.camera.zoom).toBeCloseTo(Math.exp(0.2), 12);
    controller.dispose();
  });

  it('clamps the zoom to the configured range', () => {
    const { canvas, controller } = setup();
    controller.camera.zoom = MAX_ZOOM;
    wheel(canvas, -1);
    expect(controller.camera.zoom).toBe(MAX_ZOOM);
    controller.camera.zoom = MIN_ZOOM;
    wheel(canvas, 1);
    expect(controller.camera.zoom).toBe(MIN_ZOOM);
    controller.dispose();
  });
});
