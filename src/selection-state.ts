/**
 * What the user has selected, which body the camera is locked to, and a
 * bookmark waiting for its body to stream in. Every change to one of these
 * goes through here so the rules (a new selection drops the lock and any
 * pending bookmark; only planets and moons lock) live in one place.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { Bookmark } from './bookmarks';
import type { Selection } from './pick';

import { lockedBodyLocalPos } from './camera/framing';
import { galaxyAt } from './generation/galaxies';
import { findEntityByName } from './pick';

type BodyBookmarkKind = 'black-hole' | 'moon' | 'planet' | 'star';

export class SelectionState {
  private locked: EntityId | null = null;
  private pending: Bookmark | null = null;
  private selected: Selection | null = null;

  cancelPending(): void {
    this.pending = null;
  }

  get lockedId(): EntityId | null {
    return this.locked;
  }

  /** The locked body's live render-origin-local position; unlocks when it streamed out. */
  lockedPosition(world: EcsWorld, simSeconds: number): { x: number; y: number; z: number } | null {
    if (this.locked === null)
      return null;
    const pos = lockedBodyLocalPos(world, this.locked, simSeconds);
    if (!pos)
      this.locked = null;
    return pos;
  }

  lockSelectedOrbiter(): void {
    const sel = this.selected;
    if (sel && (sel.kind === 'planet' || sel.kind === 'moon'))
      this.locked = sel.id;
  }

  /**
   * Select a bookmark's target. Returns the entity id when the body is already
   * streamed (the caller centres on its live position); otherwise the bookmark
   * stays pending until `resolvePending` finds it.
   */
  openBookmark(bm: Bookmark, world: EcsWorld, seed: number): EntityId | null {
    // Like the old bookmarkZoomTo: drop the lock and any earlier pending
    // bookmark, but keep the current selection until the new one resolves.
    this.locked = null;
    this.pending = null;
    if (bm.kind === 'universe') {
      this.select({ kind: 'universe', seed });
      return null;
    }
    if (bm.kind === 'galaxy') {
      const galaxy = galaxyAt(seed, bm.x, bm.y);
      if (galaxy)
        this.select({ galaxy, kind: 'galaxy' });
      return null;
    }
    const id = findEntityByName(world, bm.name);
    if (id === null) {
      this.pending = bm;
      return null;
    }
    this.selectBody(id, bm.kind);
    return id;
  }

  /** Once a pending bookmark's body has streamed in, select it and return its id. */
  resolvePending(world: EcsWorld): EntityId | null {
    const bm = this.pending;
    if (!bm)
      return null;
    const id = findEntityByName(world, bm.name);
    if (id === null)
      return null;
    this.selectBody(id, bm.kind as BodyBookmarkKind);
    return id;
  }

  select(next: Selection | null): void {
    this.selected = next;
    this.locked = null;
    this.pending = null;
  }

  private selectBody(id: EntityId, kind: BodyBookmarkKind): void {
    this.select({ id, kind });
    this.lockSelectedOrbiter();
  }

  get selection(): Selection | null {
    return this.selected;
  }

  toggleLock(): void {
    const sel = this.selected;
    if (!sel || (sel.kind !== 'planet' && sel.kind !== 'moon'))
      return;
    this.locked = this.locked === sel.id ? null : sel.id;
  }

  unlock(): void {
    this.locked = null;
  }
}
