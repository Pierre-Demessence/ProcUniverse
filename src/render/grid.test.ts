import { makeCamera } from '@pierre/ecs/modules/camera';
import { describe, expect, it } from 'vitest';

import { drawReferenceGrid } from './grid';

/**
 * A canvas-2D stub that counts `moveTo` calls (one per grid line) and aborts if
 * they run away, so a regression to the old absolute-coordinate loop fails fast
 * instead of hanging.
 */
function countingCtx(): { ctx: CanvasRenderingContext2D; moveTos: () => number } {
  let moveTos = 0;
  const noop = (): void => {};
  const ctx = {
    beginPath: noop,
    lineTo: noop,
    lineWidth: 0,
    restore: noop,
    save: noop,
    stroke: noop,
    strokeStyle: '',
    moveTo: (): void => {
      moveTos += 1;
      if (moveTos > 100_000)
        throw new Error('drawReferenceGrid issued too many lines — unbounded loop');
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, moveTos: () => moveTos };
}

describe('drawReferenceGrid', () => {
  it('stays bounded at a huge render origin and high zoom', () => {
    const { ctx, moveTos } = countingCtx();
    // localCam is in the render frame (small); the origin is a far galaxy's star.
    // Before the fix, the sub-AU step fell below the ULP of the absolute
    // coordinate and `wx += step` looped forever.
    const cam = makeCamera({ viewportH: 1080, viewportW: 1920, x: 0, y: 0, zoom: 1e7 });
    drawReferenceGrid(ctx, cam, 1e13, 1e13);
    expect(moveTos()).toBeLessThan(200);
  });

  it('draws a reasonable grid near the world origin', () => {
    const { ctx, moveTos } = countingCtx();
    const cam = makeCamera({ viewportH: 1080, viewportW: 1920, x: 0, y: 0, zoom: 1 });
    drawReferenceGrid(ctx, cam, 0, 0);
    expect(moveTos()).toBeGreaterThan(0);
    expect(moveTos()).toBeLessThan(200);
  });
});
