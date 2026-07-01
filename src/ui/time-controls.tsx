/**
 * On-screen simulation clock and time-scale control. The whole simulation runs
 * on a single accumulating `simSeconds` value; this overlay renders it as a
 * human-readable calendar date (epoch: 1 January 2100 UTC = second 0) so the
 * viewer can see "when" they are, and a slider sets how many simulated seconds
 * elapse per real second (0 pauses).
 *
 * Built with Preact + signals. The per-frame `simSeconds` feeds a `computed`
 * date string bound directly into JSX, so only that text node updates each
 * frame — the component itself never re-renders on the hot path.
 */

import type { ReadonlySignal, Signal } from '@preact/signals';
import type { VNode } from 'preact';

import { computed, signal } from '@preact/signals';
import { render } from 'preact';

import { DEFAULT_SPEED_INDEX, SIM_EPOCH_MS, SPEED_STEPS } from '../config/render';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_YEAR = 31557600; // Julian year

export interface TimeControls {
  readonly element: HTMLElement;
  readonly speedIndex: number;
  readonly timeScale: number;
  dispose: () => void;
  update: (simSeconds: number) => void;
}

export function sliderToScale(value: number): number {
  return SPEED_STEPS[value] ?? 0;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Trim to at most two decimals without trailing zeros (1.50 -> "1.5"). */
function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Format `simSeconds` since the epoch as `YYYY-MM-DD HH:MM:SS UTC`. */
export function formatSimDate(simSeconds: number): string {
  const date = new Date(SIM_EPOCH_MS + simSeconds * 1000);
  if (Number.isNaN(date.getTime()))
    return 'date beyond range';
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** Friendly "simulated time per real second" rate, e.g. `1.5 days/s`. */
export function formatRate(scale: number): string {
  if (scale <= 0)
    return 'paused';
  if (scale >= SECONDS_PER_YEAR)
    return `${trim(scale / SECONDS_PER_YEAR)} yr/s`;
  if (scale >= SECONDS_PER_DAY)
    return `${trim(scale / SECONDS_PER_DAY)} days/s`;
  if (scale >= SECONDS_PER_HOUR)
    return `${trim(scale / SECONDS_PER_HOUR)} hr/s`;
  if (scale >= SECONDS_PER_MINUTE)
    return `${trim(scale / SECONDS_PER_MINUTE)} min/s`;
  return `${trim(scale)} s/s`;
}

const PANEL_CSS = [
  'position:absolute',
  'top:10px',
  'right:10px',
  'display:flex',
  'flex-direction:column',
  'gap:4px',
  'padding:8px 10px',
  'min-width:184px',
  'background:rgba(8,12,24,0.66)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'user-select:none',
  'pointer-events:auto',
].join(';');

const CAPTION_CSS = 'font-size:10px; letter-spacing:0.12em; color:rgba(160,190,240,0.6)';
const DATE_CSS = 'font-size:13px';
const ROW_CSS = 'display:flex; align-items:center; gap:8px';
const SLIDER_CSS = 'flex:1; accent-color:#6f93b0; cursor:pointer';
const RATE_CSS = 'min-width:64px; text-align:right; color:rgba(190,210,250,0.85)';

interface TimePanelProps {
  date: ReadonlySignal<string>;
  rate: ReadonlySignal<string>;
  speedIndex: Signal<number>;
}

function TimePanel({ date, rate, speedIndex }: TimePanelProps): VNode {
  return (
    <div style={PANEL_CSS}>
      <div style={CAPTION_CSS}>SIM TIME</div>
      <div style={DATE_CSS}>{date}</div>
      <div style={ROW_CSS}>
        <input
          type="range"
          min={0}
          max={SPEED_STEPS.length - 1}
          step={1}
          value={speedIndex.value}
          style={SLIDER_CSS}
          aria-label="Simulation speed"
          onInput={(e) => {
            speedIndex.value = Number((e.target as HTMLInputElement).value);
          }}
        />
        <div style={RATE_CSS}>{rate}</div>
      </div>
    </div>
  );
}

/**
 * Build the time-control overlay and append it to `container` (which must be a
 * positioned ancestor — `#root` is `position: fixed`). The returned handle
 * exposes the live `timeScale`, an `update(simSeconds)` to refresh the date
 * readout each frame, and `dispose()` to detach.
 */
export function createTimeControls(container: HTMLElement, initialSpeedIndex = DEFAULT_SPEED_INDEX): TimeControls {
  const speedIndex = signal(initialSpeedIndex);
  const simSeconds = signal(0);
  const date = computed(() => formatSimDate(simSeconds.value));
  const rate = computed(() => formatRate(sliderToScale(speedIndex.value)));

  const mount = document.createElement('div');
  container.append(mount);
  render(<TimePanel date={date} rate={rate} speedIndex={speedIndex} />, mount);

  return {
    element: mount,
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
    get speedIndex(): number {
      return speedIndex.value;
    },
    get timeScale(): number {
      return sliderToScale(speedIndex.value);
    },
    update(seconds: number): void {
      simSeconds.value = seconds;
    },
  };
}
