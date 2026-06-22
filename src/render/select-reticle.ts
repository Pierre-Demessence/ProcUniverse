const COLOR = 'rgba(255, 95, 95, 0.95)';
const GAP_PX = 6;
const MIN_RADIUS_PX = 14;
const ARROW_PX = 6;

/** Outward cardinal unit vectors (N, E, S, W) the four arrowheads sit on. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Draw a four-arrow selection reticle centred on `(sx, sy)` in screen space.
 * Each arrowhead points inward toward the body from radius
 * `max(discPx + GAP_PX, MIN_RADIUS_PX)`, so even a sub-pixel disc gets a clear,
 * legible lock that the caller can re-draw every frame to track a moving body.
 */
export function drawSelectReticle(ctx2d: CanvasRenderingContext2D, sx: number, sy: number, discPx: number): void {
  const radius = Math.max(discPx + GAP_PX, MIN_RADIUS_PX);
  ctx2d.save();
  ctx2d.fillStyle = COLOR;
  for (const [ux, uy] of DIRECTIONS) {
    const px = -uy;
    const py = ux;
    const tipX = sx + ux * radius;
    const tipY = sy + uy * radius;
    const baseX = sx + ux * (radius + ARROW_PX);
    const baseY = sy + uy * (radius + ARROW_PX);
    ctx2d.beginPath();
    ctx2d.moveTo(tipX, tipY);
    ctx2d.lineTo(baseX + px * ARROW_PX, baseY + py * ARROW_PX);
    ctx2d.lineTo(baseX - px * ARROW_PX, baseY - py * ARROW_PX);
    ctx2d.closePath();
    ctx2d.fill();
  }
  ctx2d.restore();
}
