import type { BodyName, GeneratedName } from './naming';

import { describe, expect, it } from 'vitest';

import { hashSystem } from './hash';
import { catalogNumber, displayName, nameMoon, namePlanet, nameStar, planetSuffix, romanNumeral } from './naming';

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
    expect(nameStar('G', h).scientific).toBe(`G-${catalogNumber(h)}`);
  });

  it('is deterministic and tracks the class prefix', () => {
    const h = hashSystem(1, 2, 3, 4, 5);
    expect(nameStar('M', h)).toEqual(nameStar('M', h));
    expect(nameStar('M', h).scientific.startsWith('M-')).toBe(true);
    expect(nameStar('O', h).scientific.startsWith('O-')).toBe(true);
  });

  it('produces a human name that differs from the scientific one', () => {
    const h = hashSystem(42, 1, 2, 3, 4);
    const names = nameStar('G', h);
    expect(names.human).not.toBe(names.scientific);
    expect(names.human.length).toBeGreaterThan(1);
    expect(names.human).toMatch(/^[A-Z][a-z]+$/);
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
  const star: GeneratedName = { human: 'Talos', scientific: 'G-12AB3' };

  it('appends the orbital letter in both styles', () => {
    const p0 = namePlanet(star, 0, 99);
    expect(p0.scientific).toBe('G-12AB3 b');
    expect(p0.human).toBe('Talos b');
    const p2 = namePlanet(star, 2, 101);
    expect(p2.scientific).toBe('G-12AB3 d');
    expect(p2.human).toBe('Talos d');
  });

  it('replaces the orbital letter with an Earth-like name when ESI is high', () => {
    const earth = namePlanet(star, 0, 42, 0.9);
    expect(earth.scientific).toBe('G-12AB3 b');
    expect(earth.human).not.toContain('b');
    expect(earth.human.length).toBeGreaterThan(1);
    expect(earth.human).toMatch(/^[A-Z][a-z]+$/);
  });

  it('does not use Earth-like name when ESI is below threshold', () => {
    const normal = namePlanet(star, 0, 42, 0.8);
    expect(normal.human).toBe('Talos b');
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
  const planet: GeneratedName = { human: 'Talos b', scientific: 'G-4F2A9 b' };

  it('appends the 1-based orbital order in Roman numerals in both styles', () => {
    expect(nameMoon(planet, 0)).toEqual({ human: 'Talos b I', scientific: 'G-4F2A9 b I' });
    expect(nameMoon(planet, 1)).toEqual({ human: 'Talos b II', scientific: 'G-4F2A9 b II' });
    expect(nameMoon(planet, 3)).toEqual({ human: 'Talos b IV', scientific: 'G-4F2A9 b IV' });
  });
});

describe('displayName', () => {
  const name: BodyName = { human: 'Talos', scientific: 'G-4F2A9' };

  it('returns the human name when the style is human', () => {
    expect(displayName(name, 'human')).toBe('Talos');
  });

  it('returns the scientific name when the style is scientific', () => {
    expect(displayName(name, 'scientific')).toBe('G-4F2A9');
  });

  it('returns Unknown for undefined', () => {
    expect(displayName(undefined, 'human')).toBe('Unknown');
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
