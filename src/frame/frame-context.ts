import type { Camera } from '@pierre/ecs/modules/camera';

import type { SystemData } from '../generation/universe';
import type { SectorRange, Tier } from '../lod/tier';

/** Per-frame values produced by earlier systems and read by later ones. */
export interface FrameCtx {
  backendChanged: boolean;
  camAbsX: number;
  camAbsY: number;
  camMoved: boolean;
  /** False when nothing changed, so the heavy render pass is skipped. */
  dirty: boolean;
  dtMs: number;
  focusedSystem: SystemData | null;
  /** Camera copy in the render-origin frame, built by the render step. */
  localCam: Camera | null;
  range: SectorRange;
  renderedByThree: boolean;
  /** Objects drawn, or -1 at the system tier where the streamer reports it. */
  renderResult: number;
  selChanged: boolean;
  threeActive: boolean;
  threeMode: boolean;
  tier: Tier;
  tierChanged: boolean;
  vpChanged: boolean;
}

export function createFrameCtx(dtMs: number, tier: Tier): FrameCtx {
  return {
    backendChanged: false,
    camAbsX: 0,
    camAbsY: 0,
    camMoved: false,
    dirty: false,
    dtMs,
    focusedSystem: null,
    localCam: null,
    range: { maxSx: 0, maxSy: 0, minSx: 0, minSy: 0 },
    renderedByThree: false,
    renderResult: -1,
    selChanged: false,
    threeActive: false,
    threeMode: false,
    tier,
    tierChanged: false,
    vpChanged: false,
  };
}
