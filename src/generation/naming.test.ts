import { describe, expect, it } from 'vitest';

import { hashSystem } from './hash';
import { catalogNumber, nameMoon, namePlanet, nameStar, planetSuffix, romanNumeral } from './naming';

describe('catalogNumber', () => {
  it('is a fixed-width, zero-padded base-36 designation', () => {
    expect(catalogNumber(0)).toBe('00000');
    expect(catalogNumber(35)).toBe('0000Z');
    expect(catalogNumber(36)).toBe('00010');
  });

  it('stays five base-36 digits for any uint32 hash', () => {
    expect(catalogNumber(0xFFFFFFFF)).toMatch(/^[0-9A-Z]{5}$/);
  });
});

describe('nameStar', () => {
  it('prefixes the spectral class then the catalogue number', () => {
    const h = hashSystem(1337, 0, 0, 1, 2);
    expect(nameStar('G', h)).toBe(`G-${catalogNumber(h)}`);
  });

  it('is deterministic and tracks the class prefix', () => {
    const h = hashSystem(1, 2, 3, 4, 5);
    expect(nameStar('M', h)).toBe(nameStar('M', h));
    expect(nameStar('M', h).startsWith('M-')).toBe(true);
    expect(nameStar('O', h).startsWith('O-')).toBe(true);
  });
});

describe('planetSuffix', () => {
  it('letters planets from b outward by orbital order', () => {
    expect(planetSuffix(0)).toBe('b');
    expect(planetSuffix(1)).toBe('c');
    expect(planetSuffix(4)).toBe('f');
  });
});

describe('namePlanet', () => {
  it('appends the orbital letter to the star designation', () => {
    expect(namePlanet('G-12AB3', 0)).toBe('G-12AB3 b');
    expect(namePlanet('G-12AB3', 2)).toBe('G-12AB3 d');
  });
});

describe('romanNumeral', () => {
  it('renders the standard additive and subtractive forms', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(3)).toBe('III');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(14)).toBe('XIV');
    expect(romanNumeral(40)).toBe('XL');
    expect(romanNumeral(90)).toBe('XC');
  });
});

describe('nameMoon', () => {
  it('appends the 1-based orbital order in Roman numerals', () => {
    expect(nameMoon('G-4F2A9 b', 0)).toBe('G-4F2A9 b I');
    expect(nameMoon('G-4F2A9 b', 1)).toBe('G-4F2A9 b II');
    expect(nameMoon('G-4F2A9 b', 3)).toBe('G-4F2A9 b IV');
  });
});

describe('hashSystem', () => {
  it('is deterministic and varies with every coordinate and the seed', () => {
    expect(hashSystem(1, 0, 0, 0, 0)).toBe(hashSystem(1, 0, 0, 0, 0));
    expect(hashSystem(1, 0, 0, 0, 0)).not.toBe(hashSystem(2, 0, 0, 0, 0));
    expect(hashSystem(1, 0, 0, 0, 0)).not.toBe(hashSystem(1, 1, 0, 0, 0));
    expect(hashSystem(1, 0, 0, 0, 0)).not.toBe(hashSystem(1, 0, 1, 0, 0));
    expect(hashSystem(1, 0, 0, 0, 0)).not.toBe(hashSystem(1, 0, 0, 1, 0));
    expect(hashSystem(1, 0, 0, 0, 0)).not.toBe(hashSystem(1, 0, 0, 0, 1));
  });
});
