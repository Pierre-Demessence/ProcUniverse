import { describe, expect, it } from 'vitest';

import { DEFAULT_SPEED_INDEX } from '../config/render';
import { parseSave } from './save';

describe('parseSave', () => {
  it('returns null for missing, malformed, or seedless payloads', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('42')).toBeNull();
    expect(parseSave('{}')).toBeNull();
    expect(parseSave('{"seed":-1}')).toBeNull();
    expect(parseSave('{"seed":1.5}')).toBeNull();
  });

  it('fills defaults for absent session fields', () => {
    expect(parseSave('{"seed":7}')).toEqual({
      bookmarks: [],
      seed: 7,
      simSeconds: 0,
      speedIndex: DEFAULT_SPEED_INDEX,
      version: 1,
      view: null,
    });
  });

  it('rejects an out-of-range speed index and negative sim time', () => {
    expect(parseSave(JSON.stringify({ seed: 1, simSeconds: -5, speedIndex: -1 }))).toEqual({
      bookmarks: [],
      seed: 1,
      simSeconds: 0,
      speedIndex: DEFAULT_SPEED_INDEX,
      version: 1,
      view: null,
    });
    expect(parseSave(JSON.stringify({ seed: 1, speedIndex: 9999 }))?.speedIndex).toBe(DEFAULT_SPEED_INDEX);
  });

  it('drops a malformed view but keeps a valid one', () => {
    expect(parseSave(JSON.stringify({ seed: 1, view: { x: 1, y: 2 } }))?.view).toBeNull();
    expect(parseSave(JSON.stringify({ seed: 1, view: { x: 1, y: 2, zoom: 0 } }))?.view).toBeNull();
    expect(parseSave(JSON.stringify({ seed: 1, view: { x: 1, y: 2, zoom: 3 } }))?.view).toEqual({ x: 1, y: 2, zoom: 3 });
  });

  it('round-trips a full save', () => {
    const save = { bookmarks: [], seed: 42, simSeconds: 123.5, speedIndex: 4, version: 1, view: { x: 10, y: -20, zoom: 0.5 } };
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('parses bookmarks and drops malformed ones', () => {
    const raw = JSON.stringify({
      seed: 1,
      bookmarks: [
        { name: 'G-4F2A9', extentAu: 50, kind: 'star', label: 'Test Star', x: 100, y: 200 },
        { name: 'bad', extentAu: 1, kind: 'invalid', label: 'Bad', x: 0, y: 0 },
        { name: 'NGC-12345', extentAu: 100, kind: 'galaxy', label: 'Test Galaxy', x: 500, y: 600 },
        null,
        { name: 'incomplete' },
      ],
    });
    const save = parseSave(raw);
    expect(save?.bookmarks).toHaveLength(2);
    expect(save?.bookmarks[0]).toEqual({ name: 'G-4F2A9', extentAu: 50, kind: 'star', label: 'Test Star', x: 100, y: 200 });
    expect(save?.bookmarks[1]).toEqual({ name: 'NGC-12345', extentAu: 100, kind: 'galaxy', label: 'Test Galaxy', x: 500, y: 600 });
  });

  it('defaults bookmarks to empty array when absent', () => {
    expect(parseSave('{"seed":1}')?.bookmarks).toEqual([]);
  });
});
