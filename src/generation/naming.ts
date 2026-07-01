/**
 * Deterministic body identity. Every body gets TWO names derived from the same
 * hash: a *scientific* catalogue designation (the stable identity key) and a
 * human* readable name generated from syllables. Both are pure functions of
 * where the body sits in the universe hierarchy, so they need no persistence:
 * regenerating a sector reproduces the same pair.
 *
 * A user-toggleable `NamingStyle` setting picks which one is displayed; the
 * `displayName` helper encapsulates the choice so consumers don't branch.
 */

import type { ComponentDef } from '@pierre/ecs/component-store';

import type { SpectralClass } from './stars';

import { simpleComponent } from '@pierre/ecs/component-store';

import { generateWord } from './syllables';

// ── Component ───────────────────────────────────────────────────────────────

/** A body's two display names, attached to its entity for the HUD and labels. */
export interface BodyName {
  /** Human-readable name for the 'human' naming style. */
  human: string;
  /** Stable unique key — always the scientific catalogue designation. */
  scientific: string;
}

export const NameDef: ComponentDef<BodyName> = simpleComponent<BodyName>('name', {
  human: 'string',
  scientific: 'string',
});

// ── Display helper ──────────────────────────────────────────────────────────

/** Which naming scheme is currently displayed. */
export type NamingStyle = 'human' | 'scientific';

/**
 * Resolve a body's display name under the active naming style.
 * `name` may be undefined (e.g. during entity teardown); returns 'Unknown'.
 */
export function displayName(name: BodyName | undefined, style: NamingStyle): string {
  if (!name)
    return 'Unknown';
  return style === 'human' ? name.human : name.scientific;
}

// ── Generated-name container ────────────────────────────────────────────────

/** A pair of names produced by one of the `name*` functions below. */
export interface GeneratedName {
  human: string;
  scientific: string;
}

// ── Catalogue number (scientific style only) ────────────────────────────────

const CATALOG_DIGITS = 5;
const CATALOG_SPACE = 36 ** CATALOG_DIGITS;

/** Render a hash as a zero-padded, uppercase base-36 catalogue number. */
export function catalogNumber(hash: number): string {
  return (hash % CATALOG_SPACE).toString(36).toUpperCase().padStart(CATALOG_DIGITS, '0');
}

// ── Galaxies ────────────────────────────────────────────────────────────────

/** A galaxy's names: scientific `NGC-XXXXX`, human from 2–3 syllables. */
export function nameGalaxy(galaxyHash: number): GeneratedName {
  return {
    human: generateWord(galaxyHash, 2, 3),
    scientific: `NGC-${catalogNumber(galaxyHash)}`,
  };
}

// ── Stars ───────────────────────────────────────────────────────────────────

/**
 * A star's names: scientific `G-4F2A9` (spectral class + catalogue number),
 * human from 2–3 syllables of the system hash.
 */
export function nameStar(spectralClass: SpectralClass, systemHash: number): GeneratedName {
  return {
    human: generateWord(systemHash, 2, 3),
    scientific: `${spectralClass}-${catalogNumber(systemHash)}`,
  };
}

// ── Planets ─────────────────────────────────────────────────────────────────

const FIRST_PLANET_CHAR = 98;

/** The orbital letter for the `index`-th planet (innermost = 0 → 'b'). */
export function planetSuffix(index: number): string {
  return String.fromCharCode(FIRST_PLANET_CHAR + index);
}

// Earth Similarity Index threshold: above this a planet is "Earth-like" and
// gets a proper name instead of an orbital letter in human mode.
const EARTHLIKE_ESI_THRESHOLD = 0.85;

// Curated proper names for Earth-like worlds — short, evocative, readable.
const EARTHLIKE_NAMES = [
  'Gaia',
  'Terra',
  'Eden',
  'Avalon',
  'Arcadia',
  'Elysium',
  'Haven',
  'Cradle',
  'Pacha',
  'Midgard',
  'Aaru',
  'Dilmun',
  'Asphodel',
  'Ama',
  'Pangaea',
  'Nova',
  'Aurora',
  'Verdant',
  'Oceana',
  'Empyrea',
] as const;

/** Pick an Earth-like proper name deterministically from a planet hash. */
function earthlikeName(planetHash: number): string {
  return EARTHLIKE_NAMES[planetHash % EARTHLIKE_NAMES.length];
}

/**
 * A planet's names. The scientific name is always `<star.scientific> <letter>`.
 * The human name is usually `<star.human> <letter>`, but when `esi ≥ 0.85` the
 * orbital letter is *replaced* by a proper name from the Earth-like list.
 */
export function namePlanet(
  star: GeneratedName,
  index: number,
  planetHash: number,
  esi?: number,
): GeneratedName {
  const suffix = planetSuffix(index);
  return {
    scientific: `${star.scientific} ${suffix}`,
    human: esi !== undefined && esi >= EARTHLIKE_ESI_THRESHOLD
      ? earthlikeName(planetHash)
      : `${star.human} ${suffix}`,
  };
}

// ── Moons ───────────────────────────────────────────────────────────────────

const ROMAN_NUMERALS = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
] as const;

/** The Roman numeral for a positive integer, e.g. 4 → `IV`, 14 → `XIV`. */
export function romanNumeral(value: number): string {
  let remaining = value;
  let out = '';
  for (const [amount, symbol] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      out += symbol;
      remaining -= amount;
    }
  }
  return out;
}

/**
 * A moon's names: both build on the planet's names plus the 1-based orbital
 * order in Roman numerals (index 0 → `I`).
 */
export function nameMoon(planet: GeneratedName, index: number): GeneratedName {
  const numeral = romanNumeral(index + 1);
  return {
    human: `${planet.human} ${numeral}`,
    scientific: `${planet.scientific} ${numeral}`,
  };
}
