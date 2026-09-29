import { afterEach, describe, expect, it } from 'vitest';

import { detailLevel, distanceUnit, numberNotation, resetSettings, setDetailLevel, setDistanceUnit, setNumberNotation, setTemperatureUnit, setValueMode, temperatureUnit, valueMode } from './settings';

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

describe('value mode setting', () => {
  it('defaults to relative', () => {
    expect(valueMode.value).toBe('relative');
  });

  it('updates the shared signal when set', () => {
    setValueMode('absolute');
    expect(valueMode.value).toBe('absolute');
  });
});

describe('detail level setting', () => {
  it('defaults to advanced', () => {
    expect(detailLevel.value).toBe('advanced');
  });

  it('updates the shared signal when set', () => {
    setDetailLevel('basic');
    expect(detailLevel.value).toBe('basic');
  });
});

describe('number notation setting', () => {
  it('defaults to auto', () => {
    expect(numberNotation.value).toBe('auto');
  });

  it('updates the shared signal when set', () => {
    setNumberNotation('scientific');
    expect(numberNotation.value).toBe('scientific');
  });
});

describe('resetSettings', () => {
  it('restores every setting to its default', () => {
    setTemperatureUnit('F');
    setDistanceUnit('ly');
    setValueMode('absolute');
    setDetailLevel('basic');
    setNumberNotation('scientific');
    resetSettings();
    expect(temperatureUnit.value).toBe('K');
    expect(distanceUnit.value).toBe('adaptive');
    expect(valueMode.value).toBe('relative');
    expect(detailLevel.value).toBe('advanced');
    expect(numberNotation.value).toBe('auto');
  });
});
