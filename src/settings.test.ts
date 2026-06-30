import { afterEach, describe, expect, it } from 'vitest';

import { distanceUnit, resetSettings, setDistanceUnit, setTemperatureUnit, temperatureUnit } from './settings';

afterEach(() => {
  resetSettings();
});

describe('temperature unit setting', () => {
  it('defaults to kelvin', () => {
    expect(temperatureUnit.value).toBe('K');
  });

  it('updates the shared signal when set', () => {
    setTemperatureUnit('F');
    expect(temperatureUnit.value).toBe('F');
    setTemperatureUnit('C');
    expect(temperatureUnit.value).toBe('C');
  });
});

describe('distance unit setting', () => {
  it('defaults to adaptive', () => {
    expect(distanceUnit.value).toBe('adaptive');
  });

  it('updates the shared signal when set', () => {
    setDistanceUnit('km');
    expect(distanceUnit.value).toBe('km');
    setDistanceUnit('ly');
    expect(distanceUnit.value).toBe('ly');
  });
});

describe('resetSettings', () => {
  it('restores every setting to its default', () => {
    setTemperatureUnit('F');
    setDistanceUnit('ly');
    resetSettings();
    expect(temperatureUnit.value).toBe('K');
    expect(distanceUnit.value).toBe('adaptive');
  });
});
