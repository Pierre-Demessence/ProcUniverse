/**
 * Top-centre options menu: a gear toggle and a drop-down panel of display
 * preferences. The settings live in `./settings` (persisted, signal-backed), so
 * the inspector and HUD reflect any change live.
 */

import type { Signal } from '@preact/signals';
import type { VNode } from 'preact';

import type { DistanceUnit } from '../distance';
import type { TemperatureUnit } from '../settings';

import { signal } from '@preact/signals';
import { render } from 'preact';

import { distanceUnit, resetSettings, setDistanceUnit, setTemperatureUnit, temperatureUnit } from '../settings';

export interface OptionsMenu {
  dispose: () => void;
}

const TEMPERATURE_UNITS: readonly TemperatureUnit[] = ['K', 'C', 'F'];
const TEMPERATURE_LABELS: Record<TemperatureUnit, string> = { C: '°C', F: '°F', K: 'K' };

const DISTANCE_UNITS: readonly DistanceUnit[] = ['adaptive', 'km', 'au', 'ly'];
const DISTANCE_LABELS: Record<DistanceUnit, string> = { adaptive: 'Auto', au: 'AU', km: 'km', ly: 'ly' };

const WRAP_CSS = [
  'position:absolute',
  'top:10px',
  'left:50%',
  'transform:translateX(-50%)',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'gap:6px',
  // The wrapper itself is click-through; only the gear and panel capture input.
  'pointer-events:none',
].join(';');

const GEAR_CSS = [
  'padding:5px 12px',
  'background:rgba(8,12,24,0.66)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'cursor:pointer',
  'user-select:none',
  'pointer-events:auto',
].join(';');

const PANEL_CSS = [
  'display:flex',
  'flex-direction:column',
  'gap:8px',
  'padding:10px 12px',
  'min-width:208px',
  'background:rgba(8,12,24,0.82)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'user-select:none',
  'pointer-events:auto',
].join(';');

const CAPTION_CSS = 'font-size:10px; letter-spacing:0.12em; color:rgba(160,190,240,0.6)';
const SETTING_CSS = 'display:flex; align-items:center; justify-content:space-between; gap:16px';
const LABEL_CSS = 'color:rgba(160,190,240,0.85)';
const SEGMENT_CSS = 'display:flex; gap:2px';
const RESET_CSS = [
  'margin-top:2px',
  'padding:5px 8px',
  'background:rgba(40,20,28,0.6)',
  'border:1px solid rgba(210,150,150,0.3)',
  'border-radius:5px',
  'color:#f0d8dc',
  'font:11px ui-monospace,monospace',
  'cursor:pointer',
].join(';');

/** A segmented-control button, highlighted when it is the active choice. */
function segmentCss(active: boolean): string {
  return [
    'padding:3px 9px',
    `background:${active ? 'rgba(110,147,176,0.9)' : 'rgba(120,150,210,0.12)'}`,
    'border:1px solid rgba(120,150,210,0.3)',
    'border-radius:4px',
    `color:${active ? '#0a0e1c' : '#cfe3ff'}`,
    'cursor:pointer',
    'font:11px ui-monospace,monospace',
  ].join(';');
}

/** A labelled options row: caption on the left, control on the right. */
function SettingRow({ children, label }: { children: VNode; label: string }): VNode {
  return (
    <div style={SETTING_CSS}>
      <span style={LABEL_CSS}>{label}</span>
      {children}
    </div>
  );
}

/** A segmented control: one highlighted button per option. */
function Segmented<T extends string>({ labels, onSelect, options, value }: {
  labels: Record<T, string>;
  onSelect: (value: T) => void;
  options: readonly T[];
  value: T;
}): VNode {
  return (
    <div style={SEGMENT_CSS}>
      {options.map(option => (
        <button
          key={option}
          type="button"
          style={segmentCss(option === value)}
          onClick={() => onSelect(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function OptionsPanel({ open }: { open: Signal<boolean> }): VNode {
  return (
    <div style={WRAP_CSS}>
      <button type="button" style={GEAR_CSS} onClick={() => (open.value = !open.value)}>
        ⚙ Options
      </button>
      {open.value && (
        <div style={PANEL_CSS}>
          <div style={CAPTION_CSS}>OPTIONS</div>
          <SettingRow label="Temperature">
            <Segmented options={TEMPERATURE_UNITS} value={temperatureUnit.value} labels={TEMPERATURE_LABELS} onSelect={setTemperatureUnit} />
          </SettingRow>
          <SettingRow label="Distance">
            <Segmented options={DISTANCE_UNITS} value={distanceUnit.value} labels={DISTANCE_LABELS} onSelect={setDistanceUnit} />
          </SettingRow>
          <button type="button" style={RESET_CSS} onClick={resetSettings}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Build the options menu and append it to `container` (a positioned ancestor).
 * The returned handle's `dispose` unmounts and detaches it.
 */
export function createOptionsMenu(container: HTMLElement): OptionsMenu {
  const open = signal(false);
  const mount = document.createElement('div');
  container.append(mount);
  render(<OptionsPanel open={open} />, mount);

  return {
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
  };
}
