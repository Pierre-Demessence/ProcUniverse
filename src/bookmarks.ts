/**
 * Bookmark list management. A bookmark is a self-contained record — it carries
 * everything needed to zoom to its body and identify it for the inspector,
 * without depending on the body being currently streamed.
 *
 * Bookmarks are seed-bound (they name bodies that only exist in one universe) and
 * are persisted inside the universe save (`Save.bookmarks`).
 */

import type { EcsWorld } from '@pierre/ecs';

import type { Selection } from './pick';

import { selectionFrame } from './camera/framing';
import { cameraAbsolute } from './camera/origin';
import { GALAXY_SPRITE_SCALE } from './config/render';
import { NameDef } from './generation/naming';
import { SECTOR_SIZE } from './scale';

/** A body kind — mirrors `Selection['kind']`. */
export type BookmarkKind = 'black-hole' | 'galaxy' | 'moon' | 'planet' | 'star' | 'universe';

/** A saved bookmark: identity, absolute position, and framing extent. */
export interface Bookmark {
  /** Scientific catalogue designation (empty string for the universe). Stable key within a seed. */
  name: string;
  /** Extent (AU radius) to frame on zoom-to — the larger of the visual disc and satellite apoapsis. */
  extentAu: number;
  /** Body kind for the glyph and resolution strategy. */
  kind: BookmarkKind;
  /** Human-readable label shown in the list. */
  label: string;
  /** Absolute world position (AU), for camera centring on zoom-to. */
  x: number;
  y: number;
}

/** Opaque compound key that uniquely identifies a bookmark within a seed. */
export function bookmarkKey(kind: BookmarkKind, name: string): string {
  return `${kind}:${name}`;
}

/** True when `bookmarks` already contains a bookmark with the same kind + name. */
export function isBookmarked(bookmarks: readonly Bookmark[], kind: BookmarkKind, name: string): boolean {
  return bookmarks.some(b => b.kind === kind && b.name === name);
}

/**
 * The bookmark key for the current selection, or `null` when nothing is
 * selected or the body name cannot be read (e.g. the entity streamed out).
 */
export function selectionBookmarkKey(selection: Selection, world: EcsWorld): string | null {
  if (selection.kind === 'universe')
    return bookmarkKey('universe', '');
  if (selection.kind === 'galaxy')
    return bookmarkKey('galaxy', selection.galaxy.name);
  const name = world.getStore(NameDef).get(selection.id)?.scientific;
  return name ? bookmarkKey(selection.kind, name) : null;
}

/**
 * Build a self-contained bookmark from the current selection so it can be
 * zoomed-to and inspected later, even when the body is not streamed. Absolute
 * world positions and the framing extent are captured once.
 */
export function bookmarkFromSelection(sel: Selection, world: EcsWorld, originX: number, originY: number): Bookmark | null {
  if (sel.kind === 'universe')
    return { name: '', extentAu: SECTOR_SIZE * 10, kind: 'universe', label: 'Universe', x: 0, y: 0 };
  if (sel.kind === 'galaxy') {
    return {
      name: sel.galaxy.name,
      extentAu: sel.galaxy.radius * GALAXY_SPRITE_SCALE,
      kind: 'galaxy',
      label: sel.galaxy.humanName,
      x: sel.galaxy.centerX,
      y: sel.galaxy.centerY,
    };
  }
  const frame = selectionFrame(sel, world, originX, originY);
  const identity = world.getStore(NameDef).get(sel.id);
  if (!frame || !identity)
    return null;
  return {
    name: identity.scientific,
    extentAu: frame.extentAu,
    kind: sel.kind,
    label: identity.human,
    x: cameraAbsolute(originX, frame.x),
    y: cameraAbsolute(originY, frame.y),
  };
}

/** Add the selection's bookmark, or remove it if present. True when `bookmarks` changed. */
export function toggleBookmark(bookmarks: Bookmark[], sel: Selection, world: EcsWorld, originX: number, originY: number): boolean {
  const key = selectionBookmarkKey(sel, world);
  if (!key)
    return false;
  const idx = bookmarks.findIndex(b => bookmarkKey(b.kind, b.name) === key);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
    return true;
  }
  const bm = bookmarkFromSelection(sel, world, originX, originY);
  if (!bm)
    return false;
  bookmarks.push(bm);
  return true;
}

/** Remove the bookmark with the same kind + name. True when one was removed. */
export function removeBookmark(bookmarks: Bookmark[], bm: Bookmark): boolean {
  const idx = bookmarks.findIndex(b => bookmarkKey(b.kind, b.name) === bookmarkKey(bm.kind, bm.name));
  if (idx < 0)
    return false;
  bookmarks.splice(idx, 1);
  return true;
}
