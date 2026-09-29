/**
 * Smallest allowed `near / far` ratio. A 24-bit (or float32) depth buffer resolves
 * about 6e-8 near 1.0, and the starfield dome sits just inside `far`, so a ratio
 * much below ~1e-7 makes whole dome facets round to the cleared depth, fail the
 * depth test, and vanish. 5e-7 leaves the dome several depth steps of margin.
 */
const MIN_NEAR_OVER_FAR = 5e-7;

/** `near` never exceeds this fraction of the focus distance, so the focus is never clipped. */
const MAX_NEAR_OVER_DISTANCE = 0.1;

const NEAR_OVER_DISTANCE = 1e-3;

export interface ClipPlanes {
  far: number;
  near: number;
}

/**
 * Near/far planes for the system-view perspective camera.
 *
 * `distance` is the camera-to-focus distance, `halfHeightWorld` half the visible
 * world height at the focus, and `sceneRadius` the reach of the focused system.
 * `far` encloses the whole system; `near` follows the focus distance but is
 * raised (never past a tenth of that distance) to keep depth precision when the
 * camera is very close to a body inside a large system.
 */
export function perspectiveClipPlanes(distance: number, halfHeightWorld: number, sceneRadius: number): ClipPlanes {
  const far = Math.max(distance * 4 + halfHeightWorld * 4, distance + sceneRadius * 1.5 + halfHeightWorld * 4);
  const wanted = Math.max(distance * NEAR_OVER_DISTANCE, far * MIN_NEAR_OVER_FAR, 1e-9);
  return { far, near: Math.min(wanted, Math.max(distance * MAX_NEAR_OVER_DISTANCE, 1e-9)) };
}
