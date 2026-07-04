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

import { NameDef } from './generation/naming';

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
