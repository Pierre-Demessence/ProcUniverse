import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { FrameCtx } from './frame-context';

import { Scheduler } from '@pierre/ecs/scheduler';

/**
 * The frame steps in execution order. The order encodes past bug fixes (lock
 * before tier, bookmark resolve after streaming and orbits), so `after` chains
 * each system to its predecessor and `pipeline.test.ts` pins the whole list.
 */
export const FRAME_SYSTEM_ORDER = [
  'sim-clock',
  'lock-recentre',
  'tier-select',
  'backend-select',
  'origin-rebase',
  'streaming',
  'orbits',
  'pending-bookmark',
  'overlay-clear',
  'render-three',
  'reticle',
  'hud',
] as const;

export type FrameSystemName = typeof FRAME_SYSTEM_ORDER[number];

/** The `runAfter` list that places `name` directly after its predecessor. */
export function after(name: FrameSystemName): string[] {
  const i = FRAME_SYSTEM_ORDER.indexOf(name);
  return i === 0 ? [] : [FRAME_SYSTEM_ORDER[i - 1]];
}

export function buildFramePipeline(systems: readonly SchedulableSystem<FrameCtx>[]): Scheduler<FrameCtx> {
  const scheduler = new Scheduler<FrameCtx>();
  for (const system of systems)
    scheduler.add(system);
  scheduler.build();
  return scheduler;
}
