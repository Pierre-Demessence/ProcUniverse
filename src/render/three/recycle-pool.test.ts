import { describe, expect, it, vi } from 'vitest';

import { RecyclePool } from './recycle-pool';

describe('recyclePool', () => {
  it('builds an entry when none is free', () => {
    const build = vi.fn(() => ({}));
    const pool = new RecyclePool(build);
    pool.take();
    pool.take();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('hands a given entry back out instead of building', () => {
    const build = vi.fn(() => ({}));
    const pool = new RecyclePool(build);
    const first = pool.take();
    pool.give(first);
    expect(pool.take()).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('visits every entry ever built, in use or free', () => {
    const pool = new RecyclePool(() => ({}));
    const a = pool.take();
    const b = pool.take();
    pool.give(a);
    const seen: object[] = [];
    pool.forEach(entry => seen.push(entry));
    expect(seen).toEqual([a, b]);
  });
});
