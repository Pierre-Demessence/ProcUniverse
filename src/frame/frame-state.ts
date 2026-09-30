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
