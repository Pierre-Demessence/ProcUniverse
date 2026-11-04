import { describe, expect, it } from 'vitest';

import { SectorCache } from './sector-cache';

// Far from every galaxy, so each sector generates instantly (and empty).
const FAR = 10 ** 9;

describe('sectorCache', () => {
  it('returns the same sector on a repeat read', () => {
    const cache = new SectorCache(1, 4);
    expect(cache.get(FAR, 0, 0)).toBe(cache.get(FAR, 0, 0));
    expect(cache.peek(FAR, 0, 0)).toBe(cache.get(FAR, 0, 0));
    expect(cache.peek(FAR, 1, 0)).toBeUndefined();
  });

  it('evicts the least recently read sector, so sectors read every frame stay cached', () => {
    const cache = new SectorCache(1, 3);
    const first = cache.get(FAR, 0, 0);
    cache.get(FAR + 1, 0, 0);
    cache.get(FAR + 2, 0, 0);
    // Touch the oldest entry: it is in view again.
    expect(cache.get(FAR, 0, 0)).toBe(first);
    cache.get(FAR + 3, 0, 0);
    expect(cache.peek(FAR + 1, 0, 0)).toBeUndefined();
    expect(cache.peek(FAR, 0, 0)).toBe(first);
  });

  it('counts a peek hit as a read', () => {
    const cache = new SectorCache(1, 3);
    const first = cache.get(FAR, 0, 0);
    cache.get(FAR + 1, 0, 0);
    cache.get(FAR + 2, 0, 0);
    expect(cache.peek(FAR, 0, 0)).toBe(first);
    cache.get(FAR + 3, 0, 0);
    expect(cache.peek(FAR + 1, 0, 0)).toBeUndefined();
    expect(cache.peek(FAR, 0, 0)).toBe(first);
  });
});
