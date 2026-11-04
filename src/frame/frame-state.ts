import type { Vec3 } from '../camera/plane-basis';
import type { Tier } from '../lod/tier';

import { GALACTIC_NORMAL } from '../camera/plane-basis';

/**
 * Mutable state that lives across frames and is shared between the frame
 * systems and the input handlers in `main.ts`. The render origin is the
 * floating origin the camera offset is stored against.
 */
export class FrameState {
  currentTier: Tier;
  /** The host galaxy's disk normal as eased toward `hostTarget`; null until the first frame sets it outright. */
  hostNormal: Vec3 | null = null;
  /** The disk normal the reference plane is easing toward: that of the last galaxy the focus was inside. */
  hostTarget: Vec3 = GALACTIC_NORMAL;
  lastDrawnCount = 0;
  lastFlattenVisible = false;
  /** Last pointer position over the canvas (backing px), or null when it is outside; drives star-tier hover. */
  pointerX: number | null = null;
  pointerY: number | null = null;
  renderOriginX = 0;
  renderOriginY = 0;
  /** Height of the render origin off the galactic plane: the focused star's `z` while systems are streamed. */
  renderOriginZ = 0;
  simSeconds: number;

  constructor(init: { simSeconds: number; tier: Tier }) {
    this.simSeconds = init.simSeconds;
    this.currentTier = init.tier;
  }
}
