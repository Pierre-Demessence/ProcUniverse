// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createCameraController, easeTiltToAxis } from './camera-controller';

describe('easeTiltToAxis', () => {
  it('keeps the tilt at scale 1 and reaches the nearest straight-down pose at 0', () => {
    expect(easeTiltToAxis(0.4, 1)).toBeCloseTo(0.4);
    expect(easeTiltToAxis(0.4, 0)).toBe(0);
    // Past the pole (tilt ≈ π) the nearest straight-along-the-normal pose is π.
    expect(easeTiltToAxis(Math.PI - 0.3, 0)).toBeCloseTo(Math.PI);
    expect(easeTiltToAxis(0.4, 0.5)).toBeCloseTo(0.2);
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
