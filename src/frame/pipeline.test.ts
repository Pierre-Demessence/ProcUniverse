import type { SchedulableSystem } from '@pierre/ecs/scheduler';

import type { FrameCtx } from './frame-context';

import { describe, expect, it } from 'vitest';

import { after, buildFramePipeline, FRAME_SYSTEM_ORDER } from './pipeline';

const stub = (name: (typeof FRAME_SYSTEM_ORDER)[number]): SchedulableSystem<FrameCtx> => ({ name, runAfter: after(name), run: () => {} });

describe('frame pipeline order', () => {
  it('runs the steps in the order encoded by past bug fixes, whatever the insertion order', () => {
    const systems = [...FRAME_SYSTEM_ORDER].reverse().map(stub);
    const built = [...buildFramePipeline(systems)];
    expect(built.map(s => s.name)).toEqual([...FRAME_SYSTEM_ORDER]);
  });

  it('keeps the bug-fix orderings explicit', () => {
    const at = (n: (typeof FRAME_SYSTEM_ORDER)[number]): number => FRAME_SYSTEM_ORDER.indexOf(n);
    expect(at('lock-recentre')).toBeLessThan(at('tier-select'));
    expect(at('streaming')).toBeLessThan(at('orbits'));
    expect(at('orbits')).toBeLessThan(at('pending-bookmark'));
    expect(at('pending-bookmark')).toBeLessThan(at('render-scene'));
  });
});
