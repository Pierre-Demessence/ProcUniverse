import { describe, expect, it } from 'vitest';

import { generateSectorData } from '../generation/universe';
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

describe('sectorCache.system', () => {
  const stars = (): ReturnType<typeof generateSectorData>['stars'] => [0, 1, 2, 3].flatMap(sx => generateSectorData(1337, sx, 0, 0).stars).slice(0, 3);

  it('builds a full system once and returns it on repeat reads', () => {
    const cache = new SectorCache(1337);
    const [star] = stars();
    const system = cache.system(star);
    expect(system.planets.length).toBeGreaterThan(0);
    expect(system.star).toEqual(star.star);
    expect(cache.system(star)).toBe(system);
  });

  it('evicts the least recently read system', () => {
    const cache = new SectorCache(1337, 4, 2);
    const [a, b, c] = stars();
    const first = cache.system(a);
    const second = cache.system(b);
    // Reading `a` again makes `b` the oldest.
    expect(cache.system(a)).toBe(first);
    cache.system(c);
    expect(cache.system(a)).toBe(first);
    expect(cache.system(b)).not.toBe(second);
  });
});
