import { describe, expect, it } from 'vitest';

import { formatRate, formatSimDate, sliderToScale, SPEED_STEPS } from './time-controls';

describe('formatSimDate', () => {
  it('anchors second 0 to 1 January 2100 UTC', () => {
    expect(formatSimDate(0)).toBe('2100-01-01 00:00:00 UTC');
  });

  it('advances one day per 86,400 seconds', () => {
    expect(formatSimDate(86400)).toBe('2100-01-02 00:00:00 UTC');
  });

  it('rolls over months and shows the time of day', () => {
    expect(formatSimDate(86400 * 31)).toBe('2100-02-01 00:00:00 UTC');
    expect(formatSimDate(3661)).toBe('2100-01-01 01:01:01 UTC');
  });

  it('degrades gracefully past the representable range', () => {
    expect(formatSimDate(1e18)).toBe('date beyond range');
  });
});

describe('speed steps', () => {
  it('pauses at index 0 and snaps to preset speeds', () => {
    expect(sliderToScale(0)).toBe(0);
    expect(sliderToScale(4)).toBe(1); // real time
    expect(sliderToScale(SPEED_STEPS.length - 1)).toBe(315576000); // 10 yr/s
  });

  it('offers sub-real-time and year-scale speeds, sorted ascending', () => {
    expect(SPEED_STEPS).toContain(0.25);
    expect(SPEED_STEPS).toContain(86400); // 1 day/s
    expect(SPEED_STEPS).toContain(31557600); // 1 yr/s
    for (let i = 1; i < SPEED_STEPS.length; i++)
      expect(SPEED_STEPS[i]).toBeGreaterThan(SPEED_STEPS[i - 1]);
  });
});

describe('formatRate', () => {
  it('labels the paused state', () => {
    expect(formatRate(0)).toBe('paused');
  });

  it('shows clean sub-real-time and whole rates', () => {
    expect(formatRate(0.25)).toBe('0.25 s/s');
    expect(formatRate(1)).toBe('1 s/s');
    expect(formatRate(2)).toBe('2 s/s');
  });

  it('switches to friendly units at the boundaries', () => {
    expect(formatRate(60)).toBe('1 min/s');
    expect(formatRate(3600)).toBe('1 hr/s');
    expect(formatRate(86400)).toBe('1 days/s');
    expect(formatRate(31557600)).toBe('1 yr/s');
  });
});
