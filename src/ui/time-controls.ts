/**
 * On-screen simulation clock and time-scale control. The whole simulation runs
 * on a single accumulating `simSeconds` value; this overlay renders it as a
 * human-readable calendar date (epoch: 1 January 2100 UTC = second 0) so the
 * viewer can see "when" they are, and a slider sets how many simulated seconds
 * elapse per real second (0 pauses).
 */

import { DEFAULT_SPEED_INDEX, SIM_EPOCH_MS, SPEED_STEPS } from '../config';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_YEAR = 31557600; // Julian year

export interface TimeControls {
  readonly element: HTMLElement;
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

/**
 * Build the time-control overlay and append it to `container` (which must be a
 * positioned ancestor — `#root` is `position: fixed`). The returned handle
 * exposes the live `timeScale`, an `update(simSeconds)` to refresh the date
 * readout each frame, and `dispose()` to detach.
 */
export function createTimeControls(container: HTMLElement): TimeControls {
  let timeScale = SPEED_STEPS[DEFAULT_SPEED_INDEX];

  const panel = document.createElement('div');
  panel.style.cssText = [
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

  const caption = document.createElement('div');
  caption.textContent = 'SIM TIME';
  caption.style.cssText = 'font-size:10px; letter-spacing:0.12em; color:rgba(160,190,240,0.6)';

  const dateLabel = document.createElement('div');
  dateLabel.style.cssText = 'font-size:13px';
  dateLabel.textContent = formatSimDate(0);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex; align-items:center; gap:8px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(SPEED_STEPS.length - 1);
  slider.step = '1';
  slider.value = String(DEFAULT_SPEED_INDEX);
  slider.style.cssText = 'flex:1; accent-color:#6f93b0; cursor:pointer';
  slider.setAttribute('aria-label', 'Simulation speed');

  const rateLabel = document.createElement('div');
  rateLabel.style.cssText = 'min-width:64px; text-align:right; color:rgba(190,210,250,0.85)';
  rateLabel.textContent = formatRate(timeScale);

  const onInput = (): void => {
    timeScale = sliderToScale(Number(slider.value));
    rateLabel.textContent = formatRate(timeScale);
  };
  slider.addEventListener('input', onInput);

  row.append(slider, rateLabel);
  panel.append(caption, dateLabel, row);
  container.append(panel);

  return {
    element: panel,
    dispose(): void {
      slider.removeEventListener('input', onInput);
      panel.remove();
    },
    get timeScale(): number {
      return timeScale;
    },
    update(simSeconds: number): void {
      dateLabel.textContent = formatSimDate(simSeconds);
    },
  };
}
