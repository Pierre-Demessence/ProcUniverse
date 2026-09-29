import type { Tier } from '../lod/tier';

/**
 * Mutable state that lives across frames and is shared between the frame
 * systems and the input handlers in `main.ts`. The render origin is the
 * floating origin the camera offset is stored against.
 */
export class FrameState {
  currentTier: Tier;
  lastDrawnCount = 0;
  lastFlattenVisible = false;
  renderOriginX = 0;
  renderOriginY = 0;
  simSeconds: number;

  constructor(init: { simSeconds: number; tier: Tier }) {
    this.simSeconds = init.simSeconds;
    this.currentTier = init.tier;
  }
}
