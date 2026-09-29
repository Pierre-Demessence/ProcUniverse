import { describe, expect, it } from 'vitest';

import { perspectiveClipPlanes } from './clip-planes';

describe('perspectiveClipPlanes', () => {
  it('keeps enough depth precision for the sky dome in the reported close-zoom case', () => {
    // Values behind the skybox-hole report: near 5.2e-6, far 55.9, i.e. ratio ~1e7.
    const distance = 5.2e-3;
    const { far, near } = perspectiveClipPlanes(distance, distance * Math.tan((25 * Math.PI) / 180), 36);
    expect(far).toBeGreaterThan(50);
    expect(near / far).toBeGreaterThanOrEqual(5e-7);
  });

  it('never clips the focus: near stays a tenth of the focus distance or less', () => {
    for (const distance of [1e-6, 1e-4, 1e-2, 1, 100]) {
      const { near } = perspectiveClipPlanes(distance, distance * 0.47, 5000);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThanOrEqual(distance * 0.1 + 1e-12);
    }
  });

  it('leaves the original near plane alone when the ratio is already healthy', () => {
    const distance = 10;
    const { far, near } = perspectiveClipPlanes(distance, 4.7, 5);
    expect(near).toBeCloseTo(distance * 1e-3);
    expect(far).toBeGreaterThan(distance);
  });

  it('keeps far beyond the focus and the system reach', () => {
    const { far } = perspectiveClipPlanes(2, 1, 40);
    expect(far).toBeGreaterThanOrEqual(2 + 40 * 1.5);
  });
});
