/**
 * Floating camera origin helpers.
 *
 * The camera position is stored as a small *local* offset (`camera.x/y`) from a
 * coarse floating origin, not as an absolute world coordinate. Far from the
 * universe origin an absolute coordinate is enormous, so a pan/zoom delta can
 * fall below its float64 ULP and be lost; keeping the offset small keeps every
 * interaction and render computation precise. The absolute position is only
 * reconstructed where a small error is harmless (sector indexing, HUD readout).
 */

/** Absolute world coordinate from a floating origin and its local offset. */
export function cameraAbsolute(origin: number, local: number): number {
  return origin + local;
}

/**
 * The local offset after moving the origin from `origin` to `newOrigin`, keeping
 * the absolute position unchanged: `newLocal = local + (origin − newOrigin)`.
 * When both origins are exact sector multiples the shift is exact.
 */
export function rebaseLocal(origin: number, local: number, newOrigin: number): number {
  return local + (origin - newOrigin);
}
