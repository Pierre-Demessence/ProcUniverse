/**
 * Top-left "you are here" panel: the viewer's current location as a hierarchy
 * (Universe → Galaxy → System → Planet) derived from the camera each frame. It
 * grows as you zoom in — the System and Planet nodes appear only at the system
 * tier, where those bodies are streamed — and every body node is clickable to
 * pin it in the inspector, exactly as a canvas pick would.
 *
 * Built with Preact + signals. `update` only writes the signal when a cheap
 * content signature changes, so the panel re-renders when the location or
 * selection changes rather than every frame.
 */

import type { Signal } from '@preact/signals';
import type { VNode } from 'preact';

import type { Tier } from '../lod/tier';

import { signal } from '@preact/signals';
import { render } from 'preact';

import { NAV_TREE_INDENT_PX } from '../config/render';
import { namingStyle } from '../settings';

/** The kind of body a tree node represents. */
export type NavNodeKind = 'galaxy' | 'moon' | 'planet' | 'star' | 'universe';

/** One row of the location tree. */
export interface NavNode {
  /** Catalogue name used to resolve a click back to a body (empty if not selectable). */
  name: string;
  /** Indentation level (0 = Universe). */
  depth: number;
  /** Stable identity for selection highlighting and per-frame dedupe. */
  key: string;
  kind: NavNodeKind;
  label: string;
  /** Whether clicking the row pins it in the inspector. */
  selectable: boolean;
}

export interface NavGalaxy {
  /** Scientific catalogue designation (stable key). */
  name: string;
  /** Human-readable name for the 'human' naming style. */
  humanName: string;
}

export interface NavSystem {
  /** Scientific catalogue designation (stable key). */
  name: string;
  /** Human-readable name for the 'human' naming style. */
  humanName: string;
  planets: { humanName: string; moons: { humanName: string; name: string }[]; name: string }[];
}

/** The current location, assembled from the camera + tier each frame. */
export interface NavState {
  /** The galaxy under the camera, or `null` in intergalactic space. */
  galaxy: NavGalaxy | null;
  /** `key` of the node matching the inspector selection, for highlighting. */
  selectedKey: string | null;
  /** The focused system (system tier only). */
  system: NavSystem | null;
  tier: Tier;
}

export interface NavTree {
  dispose: () => void;
  update: (state: NavState) => void;
}

const NODE_GLYPH: Record<NavNodeKind, string> = {
  galaxy: '◎',
  moon: '☾',
  planet: '◦',
  star: '☉',
  universe: '✦',
};

/**
 * The visible tree rows for a location, ordered top-down. Only nodes relevant
 * to the current tier are emitted: Universe always; the Galaxy below it at any
 * tier inside a galaxy (except the cosmic `universe` tier); and the focused
 * System with its planets only at the `system` tier.
 */
export function navNodes(state: NavState): NavNode[] {
  const nodes: NavNode[] = [
    { name: '', depth: 0, key: 'universe', kind: 'universe', label: 'Universe', selectable: true },
  ];

  const showGalaxy = state.tier !== 'universe' && state.galaxy !== null;
  const style = namingStyle.value;
  if (showGalaxy && state.galaxy) {
    nodes.push({
      name: state.galaxy.name,
      depth: 1,
      key: `galaxy:${state.galaxy.name}`,
      kind: 'galaxy',
      label: style === 'human' ? state.galaxy.humanName : state.galaxy.name,
      selectable: true,
    });
  }

  if (state.tier === 'system' && state.system) {
    const systemDepth = showGalaxy ? 2 : 1;
    nodes.push({
      name: state.system.name,
      depth: systemDepth,
      key: state.system.name,
      kind: 'star',
      label: style === 'human' ? state.system.humanName : state.system.name,
      selectable: true,
    });
    for (const planet of state.system.planets) {
      nodes.push({
        name: planet.name,
        depth: systemDepth + 1,
        key: planet.name,
        kind: 'planet',
        label: style === 'human' ? planet.humanName : planet.name,
        selectable: true,
      });
      // Moons appear directly under their planet at the system tier, so every
      // moon in the focused system is listed without zooming to the planet.
      for (const moon of planet.moons) {
        nodes.push({
          name: moon.name,
          depth: systemDepth + 2,
          key: moon.name,
          kind: 'moon',
          label: style === 'human' ? moon.humanName : moon.name,
          selectable: true,
        });
      }
    }
  }

  return nodes;
}

/** A cheap content fingerprint so the panel re-renders only when it changes. */
export function navSignature(state: NavState): string {
  const planets = state.system
    ? state.system.planets.map(p => `${p.name}(${p.moons.map(m => m.name).join(',')})`).join(',')
    : '';
  return [state.tier, state.galaxy?.name ?? '', state.system?.name ?? '', planets, state.selectedKey ?? ''].join('|');
}

const PANEL_CSS = [
  'position:absolute',
  'top:10px',
  'left:10px',
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
const BODY_CSS = 'display:flex; flex-direction:column; gap:2px';
const ROW_CSS = 'display:flex; align-items:center; gap:6px; border-radius:4px; padding:1px 4px';
const GLYPH_CSS = 'width:1em; text-align:center; opacity:0.7';
const LABEL_CSS = 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis';
const SELECTABLE_CSS = 'cursor:pointer';
const SELECTED_CSS = 'background:rgba(120,150,210,0.22); color:#eaf2ff';

function NavRow({ node, onSelect, selected }: { node: NavNode; onSelect: (node: NavNode) => void; selected: boolean }): VNode {
  const parts = [ROW_CSS, `margin-left:${node.depth * NAV_TREE_INDENT_PX}px`];
  if (node.selectable)
    parts.push(SELECTABLE_CSS);
  if (selected)
    parts.push(SELECTED_CSS);
  return (
    <div
      style={parts.join('; ')}
      title={node.selectable ? 'Click to inspect' : undefined}
      onClick={node.selectable ? () => onSelect(node) : undefined}
    >
      <span style={GLYPH_CSS}>{NODE_GLYPH[node.kind]}</span>
      <span style={LABEL_CSS}>{node.label}</span>
    </div>
  );
}

function NavTreePanel({ onSelect, state }: { onSelect: (node: NavNode) => void; state: Signal<NavState | null> }): VNode | null {
  const current = state.value;
  if (!current)
    return null;
  const nodes = navNodes(current);
  return (
    <div style={PANEL_CSS}>
      <div style={CAPTION_CSS}>LOCATION</div>
      <div style={BODY_CSS}>
        {nodes.map(node => (
          <NavRow key={node.key} node={node} onSelect={onSelect} selected={node.key === current.selectedKey} />
        ))}
      </div>
    </div>
  );
}

/**
 * Build the location-tree panel and append it to `container` (a positioned
 * ancestor). `update` refreshes the current location each frame (deduped),
 * `onSelect` fires when a body node is clicked, and `dispose` detaches it.
 */
export function createNavTree(container: HTMLElement, options: { onSelect: (node: NavNode) => void }): NavTree {
  const state = signal<NavState | null>(null);
  let signature = '';

  const mount = document.createElement('div');
  container.append(mount);
  render(<NavTreePanel onSelect={options.onSelect} state={state} />, mount);

  return {
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
    update(next: NavState): void {
      const sig = navSignature(next);
      if (sig === signature)
        return;
      signature = sig;
      state.value = next;
    },
  };
}
