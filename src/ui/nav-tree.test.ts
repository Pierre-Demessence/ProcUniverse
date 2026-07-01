import type { NavState } from './nav-tree';

import { describe, expect, it } from 'vitest';

import { navNodes, navSignature } from './nav-tree';

function state(partial: Partial<NavState> = {}): NavState {
  return { galaxy: null, selectedKey: null, system: null, tier: 'system', ...partial };
}

describe('navNodes', () => {
  it('shows only the Universe root at the cosmic tier', () => {
    const nodes = navNodes(state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' }, tier: 'universe' }));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ depth: 0, key: 'universe', kind: 'universe', selectable: true });
  });

  it('shows the Universe root only in intergalactic space', () => {
    const nodes = navNodes(state({ galaxy: null, tier: 'galaxy-field' }));
    expect(nodes.map(n => n.kind)).toEqual(['universe']);
  });

  it('adds a selectable Galaxy node when inside a galaxy below the cosmic tier', () => {
    const nodes = navNodes(state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' }, system: null, tier: 'galaxy' }));
    expect(nodes.map(n => n.kind)).toEqual(['universe', 'galaxy']);
    expect(nodes[1]).toMatchObject({ name: 'NGC-1A2B', depth: 1, key: 'galaxy:NGC-1A2B', label: 'NGC-1A2B', selectable: true });
  });

  it('hides the system and planets until the system tier', () => {
    const withSystem = { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] };
    const nodes = navNodes(state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' }, system: withSystem, tier: 'star' }));
    expect(nodes.map(n => n.kind)).toEqual(['universe', 'galaxy']);
  });

  it('shows the full chain at the system tier', () => {
    const nodes = navNodes(state({
      galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' },
      system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }, { name: 'G-4F2A9 c', humanName: 'G-4F2A9 c', moons: [] }] },
      tier: 'system',
    }));
    expect(nodes.map(n => ({ depth: n.depth, key: n.key, kind: n.kind }))).toEqual([
      { depth: 0, key: 'universe', kind: 'universe' },
      { depth: 1, key: 'galaxy:NGC-1A2B', kind: 'galaxy' },
      { depth: 2, key: 'G-4F2A9', kind: 'star' },
      { depth: 3, key: 'G-4F2A9 b', kind: 'planet' },
      { depth: 3, key: 'G-4F2A9 c', kind: 'planet' },
    ]);
  });

  it('lists moons under their planet at the system tier', () => {
    const nodes = navNodes(state({
      galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' },
      system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [{ name: 'G-4F2A9 b I', humanName: 'G-4F2A9 b I' }, { name: 'G-4F2A9 b II', humanName: 'G-4F2A9 b II' }] }] },
      tier: 'system',
    }));
    expect(nodes.map(n => ({ depth: n.depth, key: n.key, kind: n.kind }))).toEqual([
      { depth: 0, key: 'universe', kind: 'universe' },
      { depth: 1, key: 'galaxy:NGC-1A2B', kind: 'galaxy' },
      { depth: 2, key: 'G-4F2A9', kind: 'star' },
      { depth: 3, key: 'G-4F2A9 b', kind: 'planet' },
      { depth: 4, key: 'G-4F2A9 b I', kind: 'moon' },
      { depth: 4, key: 'G-4F2A9 b II', kind: 'moon' },
    ]);
  });

  it('promotes the system to depth 1 when no galaxy is present', () => {
    const nodes = navNodes(state({
      galaxy: null,
      system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] },
      tier: 'system',
    }));
    expect(nodes.map(n => ({ depth: n.depth, kind: n.kind }))).toEqual([
      { depth: 0, kind: 'universe' },
      { depth: 1, kind: 'star' },
      { depth: 2, kind: 'planet' },
    ]);
  });

  it('marks every node selectable', () => {
    const nodes = navNodes(state({
      galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' },
      system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] },
      tier: 'system',
    }));
    expect(nodes.map(n => n.selectable)).toEqual([true, true, true, true]);
  });
});

describe('navSignature', () => {
  it('is stable for identical content', () => {
    const a = state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' }, system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] } });
    const b = state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' }, system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] } });
    expect(navSignature(a)).toBe(navSignature(b));
  });

  it('changes when the selection changes', () => {
    const base = state({ galaxy: { name: 'NGC-1A2B', humanName: 'NGC-1A2B' } });
    expect(navSignature(base)).not.toBe(navSignature({ ...base, selectedKey: 'galaxy:NGC-1A2B' }));
  });

  it('changes when the focused planets change', () => {
    const one = state({ system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] } });
    const two = state({ system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }, { name: 'G-4F2A9 c', humanName: 'G-4F2A9 c', moons: [] }] } });
    expect(navSignature(one)).not.toBe(navSignature(two));
  });

  it('changes when a planet gains a moon', () => {
    const none = state({ system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [] }] } });
    const one = state({ system: { name: 'G-4F2A9', humanName: 'G-4F2A9', planets: [{ name: 'G-4F2A9 b', humanName: 'G-4F2A9 b', moons: [{ name: 'G-4F2A9 b I', humanName: 'G-4F2A9 b I' }] }] } });
    expect(navSignature(none)).not.toBe(navSignature(one));
  });
});
