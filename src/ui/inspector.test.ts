import { describe, expect, it } from 'vitest';

import { SECONDS_PER_YEAR } from '../generation/units';
import {
  formatHabitability,
  formatLifetime,
  formatPeriod,
  formatPlanetType,
  formatQuantity,
  formatSeed,
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

  it('converts to whole degrees Celsius when asked', () => {
    expect(formatTemperature(5772, 'C')).toBe('5,499 °C');
    expect(formatTemperature(279.6, 'C')).toBe('6 °C');
    expect(formatTemperature(50, 'C')).toBe('-223 °C');
  });

  it('converts to whole degrees Fahrenheit when asked', () => {
    expect(formatTemperature(273.15, 'F')).toBe('32 °F');
    expect(formatTemperature(373.15, 'F')).toBe('212 °F');
    expect(formatTemperature(5772, 'F')).toBe('9,930 °F');
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

describe('formatPeriod', () => {
  it('scales a period (in years) to the largest human-readable unit', () => {
    expect(formatPeriod(30 / SECONDS_PER_YEAR)).toBe('30 s');
    expect(formatPeriod(120 / SECONDS_PER_YEAR)).toBe('2 min');
    expect(formatPeriod(7200 / SECONDS_PER_YEAR)).toBe('2 h');
    expect(formatPeriod((2 * 86400) / SECONDS_PER_YEAR)).toBe('2 days');
    expect(formatPeriod(1)).toBe('1 yr');
    expect(formatPeriod(5)).toBe('5 yr');
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

describe('formatSeed', () => {
  it('formats a seed as 8-digit uppercase hex', () => {
    expect(formatSeed(0)).toBe('0x00000000');
    expect(formatSeed(0xF3A19C4)).toBe('0x0F3A19C4');
    expect(formatSeed(0xFFFFFFFF)).toBe('0xFFFFFFFF');
  });

  it('treats the seed as an unsigned 32-bit value', () => {
    expect(formatSeed(-1)).toBe('0xFFFFFFFF');
  });
});
