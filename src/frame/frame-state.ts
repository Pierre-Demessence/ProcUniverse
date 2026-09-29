import type { Tier } from '../lod/tier';
import type { Selection } from '../pick';

/**
 * Mutable state that lives across frames and is shared between the frame
 * systems and the input handlers in `main.ts`. The render origin is the
 * floating origin the camera offset is stored against.
 */
export class FrameState {
  currentTier: Tier;
  fadeMsLeft = 0;
  lastCamX = 0;
  lastCamY = 0;
  lastCamZoom = 0;
  lastDrawnCount = 0;
  lastFlattenVisible = false;
  lastSelection: Selection | null = null;
  lastVpH = 0;
  lastVpW = 0;
  renderOriginX = 0;
  renderOriginY = 0;
  sceneCacheValid = false;
  simSeconds: number;

  constructor(init: { simSeconds: number; tier: Tier }) {
    this.simSeconds = init.simSeconds;
    this.currentTier = init.tier;
  }
}
