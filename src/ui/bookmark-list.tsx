/**
 * Bookmark list panel — anchored top-left beside the nav-tree. Each row shows a
 * bookmarked body's glyph, label, and an Inspect button that opens the inspector
 * for that body (zooming there first only when the body isn't in the current
 * view). A ✕ button removes the bookmark. When the list is empty a dim cue line
 * is shown.
 *
 * Built with Preact + signals. The owner writes the bookmark array into the
 * signal whenever it changes; the panel re-renders only when the reference
 * changes.
 */

import type { Signal } from '@preact/signals';
import type { VNode } from 'preact';

import type { Bookmark, BookmarkKind } from '../bookmarks';

import { signal } from '@preact/signals';
import { render } from 'preact';

export interface BookmarkListActions {
  onInspect: (bm: Bookmark) => void;
  onRemove: (bm: Bookmark) => void;
}

export interface BookmarkList {
  dispose: () => void;
  update: (bookmarks: readonly Bookmark[]) => void;
}

const GLYPH: Record<BookmarkKind, string> = {
  'black-hole': '●',
  'galaxy': '◎',
  'moon': '☾',
  'planet': '◦',
  'star': '☉',
  'universe': '✦',
};

const PANEL_CSS = [
  'position:absolute',
  'top:10px',
  'left:252px',
  'display:flex',
  'flex-direction:column',
  'gap:4px',
  'padding:8px 10px',
  'min-width:140px',
  'max-width:230px',
  'max-height:calc(100vh - 20px)',
  'overflow-y:auto',
  'background:rgba(8,12,24,0.66)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'user-select:none',
  'pointer-events:auto',
].join(';');

const CAPTION_CSS = 'font-size:10px; letter-spacing:0.12em; color:rgba(160,190,240,0.6)';
const EMPTY_CSS = 'font-style:italic; font-size:11px; color:rgba(160,190,240,0.4); padding:2px 0';
const BODY_CSS = 'display:flex; flex-direction:column; gap:2px';
const ROW_CSS = 'display:flex; align-items:center; gap:5px; border-radius:4px; padding:1px 4px';
const GLYPH_CSS = 'width:1em; text-align:center; opacity:0.7; flex-shrink:0';
const LABEL_CSS = 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1 1 auto; min-width:0';
const ACTIONS_CSS = 'display:flex; gap:3px; flex-shrink:0';
const ACTION_BUTTON_CSS = 'padding:1px 5px; background:rgba(255,255,255,0.06); border:1px solid rgba(120,150,210,0.2); border-radius:3px; color:#cfe3ff; font:10px ui-monospace,monospace; cursor:pointer; line-height:1.4';
const REMOVE_CSS = 'padding:0 3px; background:none; border:none; color:rgba(200,120,120,0.6); font:11px ui-monospace,monospace; cursor:pointer; flex-shrink:0';

const EMPTY_HINT = 'No bookmarks yet — select a body and click ☆.';

function BookmarkRow({ bm, onInspect, onRemove }: { bm: Bookmark; onInspect: (bm: Bookmark) => void; onRemove: (bm: Bookmark) => void }): VNode {
  return (
    <div style={ROW_CSS}>
      <span style={GLYPH_CSS}>{GLYPH[bm.kind]}</span>
      <span style={LABEL_CSS} title={bm.label}>{bm.label}</span>
      <span style={ACTIONS_CSS}>
        <button type="button" style={ACTION_BUTTON_CSS} onClick={() => onInspect(bm)}>Inspect</button>
      </span>
      <button type="button" style={REMOVE_CSS} onClick={() => onRemove(bm)}>✕</button>
    </div>
  );
}

function BookmarkPanel({ bookmarks, onInspect, onRemove }: { bookmarks: Signal<readonly Bookmark[]>; onInspect: (bm: Bookmark) => void; onRemove: (bm: Bookmark) => void }): VNode {
  const list = bookmarks.value;
  return (
    <div style={PANEL_CSS}>
      <div style={CAPTION_CSS}>BOOKMARKS</div>
      <div style={BODY_CSS}>
        {list.length === 0
          ? <div style={EMPTY_CSS}>{EMPTY_HINT}</div>
          : list.map(bm => (
              <BookmarkRow key={`${bm.kind}:${bm.name}`} bm={bm} onInspect={onInspect} onRemove={onRemove} />
            ))}
      </div>
    </div>
  );
}

/**
 * Mount the bookmark list panel on `container` (a positioned ancestor). `update`
 * pushes a new bookmark array each frame (deduped by reference); `onInspect` /
 * `onRemove` fire on the corresponding row action.
 */
export function createBookmarkList(
  container: HTMLElement,
  actions: BookmarkListActions,
): BookmarkList {
  const state = signal<readonly Bookmark[]>([]);

  const mount = document.createElement('div');
  container.append(mount);
  render(
    <BookmarkPanel
      bookmarks={state}
      onInspect={actions.onInspect}
      onRemove={actions.onRemove}
    />,
    mount,
  );

  return {
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
    update(bookmarks: readonly Bookmark[]): void {
      // New reference each frame so Preact signals detect adds/removes.
      state.value = [...bookmarks];
    },
  };
}
