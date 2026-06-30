import { afterEach, describe, expect, it } from 'vitest';

import { resetSettings, setTemperatureUnit, temperatureUnit } from './settings';

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

  it('reset restores the default', () => {
    setTemperatureUnit('F');
    resetSettings();
    expect(temperatureUnit.value).toBe('K');
  });
});
