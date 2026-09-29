/**
 * The persisted universe **save**: the world seed plus the mutable session state
 * bound to it — where the camera is, and the simulation clock and speed. All of
 * it only makes sense for one seed (the coordinates index a specific star
 * layout), so it lives together and resets as a unit when the universe changes.
 *
 * Stored as a single plain-`localStorage` JSON object: the save is written on
 * page unload, where awaiting an async storage backend would be unreliable, and
 * a missing or corrupt value simply mints a fresh universe. Display preferences
 * that should outlive a seed reset live in `preferences.ts`.
 */

import type { Bookmark } from '../bookmarks';

import { DEFAULT_SPEED_INDEX, SPEED_STEPS } from '../config/render';

export const SAVE_KEY = 'procuniverse:save';
const SAVE_VERSION = 1;

/** A persisted camera view: world-space centre (AU), zoom (pixels per AU), and 3D orbit state. */
export interface SavedView {
  azimuth: number;
  focusZ: number;
  tilt: number;
  x: number;
  y: number;
  zoom: number;
}

/** The full persisted save: the world seed plus seed-bound session state. */
export interface Save {
  bookmarks: Bookmark[];
  seed: number;
  simSeconds: number;
  speedIndex: number;
  version: number;
  view: SavedView | null;
}

function mintSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function freshSave(seed: number): Save {
  return { bookmarks: [], seed, simSeconds: 0, speedIndex: DEFAULT_SPEED_INDEX, version: SAVE_VERSION, view: null };
}

function isSpeedIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SPEED_STEPS.length;
}

function parseView(value: unknown): SavedView | null {
  if (typeof value !== 'object' || value === null)
    return null;
  const { azimuth, focusZ, tilt, x, y, zoom } = value as Record<string, unknown>;
  if (
    typeof x === 'number' && Number.isFinite(x)
    && typeof y === 'number' && Number.isFinite(y)
    && typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0
  ) {
    return {
      azimuth: typeof azimuth === 'number' && Number.isFinite(azimuth) ? azimuth : 0,
      focusZ: typeof focusZ === 'number' && Number.isFinite(focusZ) ? focusZ : 0,
      tilt: typeof tilt === 'number' && Number.isFinite(tilt) ? tilt : 0,
      x,
      y,
      zoom,
    };
  }
  return null;
}

const BOOKMARK_KINDS = new Set<string>(['black-hole', 'galaxy', 'moon', 'planet', 'star', 'universe']);

function parseBookmark(value: unknown): Bookmark | null {
  if (typeof value !== 'object' || value === null)
    return null;
  const { name, extentAu, kind, label, x, y } = value as Record<string, unknown>;
  if (
    typeof name === 'string'
    && typeof label === 'string'
    && typeof kind === 'string' && BOOKMARK_KINDS.has(kind)
    && typeof x === 'number' && Number.isFinite(x)
    && typeof y === 'number' && Number.isFinite(y)
    && typeof extentAu === 'number' && Number.isFinite(extentAu) && extentAu > 0
  ) {
    return { name, extentAu, kind: kind as Bookmark['kind'], label, x, y };
  }
  return null;
}

function parseBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value))
    return [];
  const out: Bookmark[] = [];
  for (const item of value) {
    const bm = parseBookmark(item);
    if (bm)
      out.push(bm);
  }
  return out;
}

/**
 * Parse a stored save payload. Returns null when the seed is missing or invalid
 * (the caller mints a fresh universe); otherwise fills sensible defaults for any
 * absent session field so an older or partial save still loads.
 */
export function parseSave(raw: string | null): Save | null {
  if (raw === null)
    return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  }
  catch {
    return null;
  }
  if (typeof value !== 'object' || value === null)
    return null;
  const { bookmarks, seed, simSeconds, speedIndex, view } = value as Record<string, unknown>;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0)
    return null;
  return {
    bookmarks: parseBookmarks(bookmarks),
    seed: seed >>> 0,
    simSeconds: typeof simSeconds === 'number' && Number.isFinite(simSeconds) && simSeconds >= 0 ? simSeconds : 0,
    speedIndex: isSpeedIndex(speedIndex) ? speedIndex : DEFAULT_SPEED_INDEX,
    version: SAVE_VERSION,
    view: parseView(view),
  };
}

/**
 * Resolve the save: an existing one, else a freshly minted universe (persisted
 * immediately so a reload is stable). Storage failures fall back to a
 * non-persisted minted seed.
 */
export function loadOrCreateSave(): Save {
  try {
    const existing = parseSave(localStorage.getItem(SAVE_KEY));
    if (existing)
      return existing;
    const save = freshSave(mintSeed());
    writeSave(save);
    return save;
  }
  catch {
    return freshSave(mintSeed());
  }
}

/** Persist the save; storage failures are ignored (private mode, etc.). */
export function writeSave(save: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }
  catch {
    // Best-effort persistence.
  }
}
