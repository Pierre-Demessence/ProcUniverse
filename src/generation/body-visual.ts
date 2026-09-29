import type { ComponentDef } from '@pierre/ecs/component-store';

import { simpleComponent } from '@pierre/ecs/component-store';

/**
 * How a streamed body is drawn: its colour and its drawn radius (AU). Spawn sets
 * the true visual radius; `applyBodyScale` re-floors it for the current zoom
 * every frame, and the 3D passes, labels and reticle read it.
 */
export interface BodyVisual {
  color: string;
  radius: number;
}

export const BodyVisualDef: ComponentDef<BodyVisual> = simpleComponent<BodyVisual>('bodyVisual', {
  color: 'string',
  radius: 'number',
});
