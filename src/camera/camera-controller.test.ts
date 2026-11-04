// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { ORBIT_SENSITIVITY } from '../config/render';
import { createCameraController, easeTiltToAxis, nearestTiltAxis } from './camera-controller';

const DEG = Math.PI / 180;

describe('easeTiltToAxis', () => {
  it('keeps the tilt at scale 1 and reaches the given straight-along-the-normal pose at 0', () => {
    expect(easeTiltToAxis(0.4, 1, 0)).toBeCloseTo(0.4);
    expect(easeTiltToAxis(0.4, 0, 0)).toBe(0);
    expect(easeTiltToAxis(Math.PI - 0.3, 0, Math.PI)).toBeCloseTo(Math.PI);
    expect(easeTiltToAxis(0.4, 0.5, 0)).toBeCloseTo(0.2);
  });

  it('eases the shorter way round, across the 0 / 2π wrap', () => {
    // 10° under the top-down pose, stored wrapped as 350°.
    expect(easeTiltToAxis(2 * Math.PI - 10 * DEG, 0.5, 0)).toBeCloseTo(2 * Math.PI - 5 * DEG);
    expect(easeTiltToAxis(2 * Math.PI - 10 * DEG, 1, 0)).toBeCloseTo(2 * Math.PI - 10 * DEG);
  });

  it('stays continuous through the horizon for a fixed axis', () => {
    expect(Math.abs(easeTiltToAxis(90.1 * DEG, 0.5, 0) - easeTiltToAxis(89.9 * DEG, 0.5, 0))).toBeLessThan(1 * DEG);
    expect(Math.abs(easeTiltToAxis(270.1 * DEG, 0.5, 0) - easeTiltToAxis(269.9 * DEG, 0.5, 0))).toBeLessThan(1 * DEG);
  });
});

describe('nearestTiltAxis', () => {
  it('picks top-down (0) or bottom-up (π)', () => {
    expect(nearestTiltAxis(0.3)).toBe(0);
    expect(nearestTiltAxis(2 * Math.PI - 0.3)).toBe(0);
    expect(nearestTiltAxis(Math.PI - 0.3)).toBe(Math.PI);
    expect(nearestTiltAxis(Math.PI + 0.3)).toBe(Math.PI);
  });
});

describe('camera controller 3D zoom-to-point', () => {
  const wheel = (canvas: HTMLCanvasElement, deltaY: number): void => {
    canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 10, clientY: 10, deltaY }));
  };

  it('closes the focus in on the resolved target in x, y and z', () => {
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
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

  it('keeps the flat 2D zoom (and the focus height) when the resolver has no target', () => {
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
    controller.setFocusZ(40);
    controller.setZoomTargetResolver(() => null);
    const before = controller.camera.zoom;
    wheel(canvas, -1);
    expect(controller.camera.zoom).toBeGreaterThan(before);
    expect(controller.focusZ).toBe(40);
    controller.dispose();
  });

  it('eases the reported tilt with the tilt scale without touching the stored tilt', () => {
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
    controller.restoreOrbit(0, 0.5, 0);
    controller.setTiltScale(0);
    expect(controller.tilt).toBe(0);
    controller.setTiltScale(1);
    expect(controller.tilt).toBeCloseTo(0.5);
    controller.dispose();
  });
});

describe('camera controller tilt easing', () => {
  // Right-drag the tilt by `dy` backing pixels (jsdom has no layout, so client
  // coordinates are backing pixels).
  const dragTilt = (canvas: HTMLCanvasElement, dy: number): void => {
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 0, clientY: 0, pointerId: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { button: 2, clientX: 0, clientY: dy, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2, clientX: 0, clientY: dy, pointerId: 1 }));
  };

  it('moves the camera continuously when the tilt is dragged through 90° at a reduced scale', () => {
    // Precondition: one pixel of drag carries the stored tilt from 89.9° past 90°.
    expect(89.9 * DEG + ORBIT_SENSITIVITY).toBeGreaterThan(90 * DEG);
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
    controller.restoreOrbit(0, 89.9 * DEG, 0);
    controller.setTiltScale(0.5);
    const before = controller.tilt;
    dragTilt(canvas, 1);
    expect(controller.tilt).not.toBe(before);
    // The camera must not flip to the far side of the plane.
    expect(Math.abs(controller.tilt - before)).toBeLessThan(1 * DEG);
    controller.dispose();
  });

  it('re-picks the axis once the easing ends and starts again', () => {
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
    controller.restoreOrbit(0, 89.9 * DEG, 0);
    controller.setTiltScale(0.5);
    dragTilt(canvas, 20);
    controller.setTiltScale(1);
    controller.setTiltScale(0);
    // The stored tilt is now nearer bottom-up, so the eased pose is bottom-up.
    expect(controller.tilt).toBeCloseTo(Math.PI);
    controller.dispose();
  });

  it('re-picks the axis when a saved tilt is restored mid-easing', () => {
    const canvas = document.createElement('canvas');
    const controller = createCameraController(canvas);
    controller.setTiltScale(0);
    controller.restoreOrbit(0, Math.PI - 0.2, 0);
    expect(controller.tilt).toBeCloseTo(Math.PI);
    controller.resetOrbit();
    expect(controller.tilt).toBeCloseTo(0);
    controller.dispose();
  });
});
