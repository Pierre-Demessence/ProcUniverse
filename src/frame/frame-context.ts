import type { Camera } from '@pierre/ecs/modules/camera';

import type { SystemData } from '../generation/universe';
import type { SectorRange, Tier } from '../lod/tier';

/** Per-frame values produced by earlier systems and read by later ones. */
export interface FrameCtx {
  camAbsX: number;
  camAbsY: number;
  dtMs: number;
  focusedSystem: SystemData | null;
  /** Camera copy in the render-origin frame, built by the render step. */
  localCam: Camera | null;
  range: SectorRange;
  threeActive: boolean;
  tier: Tier;
}

export function createFrameCtx(dtMs: number, tier: Tier): FrameCtx {
  return {
    camAbsX: 0,
    camAbsY: 0,
    dtMs,
    focusedSystem: null,
    localCam: null,
    range: { maxSx: 0, maxSy: 0, minSx: 0, minSy: 0 },
    threeActive: false,
    tier,
  };
}
