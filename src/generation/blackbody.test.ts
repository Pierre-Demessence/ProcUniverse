import { describe, expect, it } from 'vitest';

import { blackbodyColor } from './blackbody';

describe('blackbodyColor', () => {
  it('returns anchor colours exactly', () => {
    expect(blackbodyColor(3000)).toBe('#ffb969');
    expect(blackbodyColor(5800)).toBe('#fff1e7');
    expect(blackbodyColor(30000)).toBe('#a5baff');
  });

  it('clamps below and above the tabulated range', () => {
    expect(blackbodyColor(1000)).toBe(blackbodyColor(3000));
    expect(blackbodyColor(60000)).toBe(blackbodyColor(30000));
  });

  it('interpolates linearly between anchors', () => {
    // Midway between 3000 (#ffb969) and 3500 (#ffc989).
    expect(blackbodyColor(3250)).toBe('#ffc179');
  });

  it('shifts from red (cool) toward blue (hot)', () => {
    const cool = blackbodyColor(3000);
    const hot = blackbodyColor(30000);
    const red = (hex: string): number => Number.parseInt(hex.slice(1, 3), 16);
    const blue = (hex: string): number => Number.parseInt(hex.slice(5, 7), 16);
    expect(red(cool)).toBeGreaterThan(blue(cool));
    expect(blue(hot)).toBeGreaterThan(red(hot));
  });
});
