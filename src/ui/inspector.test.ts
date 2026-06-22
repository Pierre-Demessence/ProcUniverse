import { describe, expect, it } from 'vitest';

import {
  formatHabitability,
  formatLifetime,
  formatPlanetType,
  formatQuantity,
  formatTemperature,
  sigFigs,
} from './inspector';

describe('sigFigs', () => {
  it('keeps three significant figures by default', () => {
    expect(sigFigs(1.02345)).toBe('1.02');
    expect(sigFigs(0.0012345)).toBe('0.00123');
  });

  it('groups thousands and drops trailing zeros', () => {
    expect(sigFigs(14000)).toBe('14,000');
    expect(sigFigs(1.5)).toBe('1.5');
  });
});

describe('formatQuantity', () => {
  it('appends the unit after a three-sig-fig value', () => {
    expect(formatQuantity(1.0234, 'M☉')).toBe('1.02 M☉');
    expect(formatQuantity(0.5, 'AU')).toBe('0.5 AU');
  });
});

describe('formatTemperature', () => {
  it('rounds to whole kelvin with grouping', () => {
    expect(formatTemperature(5772)).toBe('5,772 K');
    expect(formatTemperature(279.6)).toBe('280 K');
  });
});

describe('formatLifetime', () => {
  it('scales to the largest fitting unit', () => {
    expect(formatLifetime(1e10)).toBe('10 Gyr');
    expect(formatLifetime(4.5e8)).toBe('450 Myr');
    expect(formatLifetime(4.03e5)).toBe('403 kyr');
    expect(formatLifetime(500)).toBe('500 yr');
  });
});

describe('formatPlanetType', () => {
  it('capitalises and de-hyphenates the type', () => {
    expect(formatPlanetType('rocky')).toBe('Rocky');
    expect(formatPlanetType('super-earth')).toBe('Super earth');
    expect(formatPlanetType('gas-giant')).toBe('Gas giant');
  });
});

describe('formatHabitability', () => {
  it('combines the zone verdict with the water phase', () => {
    expect(formatHabitability(true, 'liquid')).toBe('Yes · liquid');
    expect(formatHabitability(false, 'ice')).toBe('No · ice');
  });
});
