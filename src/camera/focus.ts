import type { OrbitElements } from '../sim/orbits';

import { clamp } from '@pierre/ecs/modules/math';

/**
 * The zoom (px/AU) that frames an extent of `extentAu` world-AU radius inside
 * the viewport, clamped to the camera range. The smaller of the two viewport
 * axes guarantees the extent fits in both dimensions; `margin` (>1) leaves
 * breathing room around the target.
 */
export function frameZoom(extentAu: number, vpW: number, vpH: number, margin: number, minZoom: number, maxZoom: number): number {
  return clamp(Math.min(vpW, vpH) / (2 * extentAu * margin), minZoom, maxZoom);
}

/**
 * The largest apoapsis `a·(1+e)` in a list of orbits, or `0` when the list is
 * empty — so the fallback disc-framing takes over.
 */
export function maxApoapsis(orbits: readonly OrbitElements[]): number {
  let max = 0;
  for (let i = 0; i < orbits.length; i++) {
    const { a, e } = orbits[i];
    const apo = a * (1 + e);
    if (apo > max)
      max = apo;
  }
  return max;
}
