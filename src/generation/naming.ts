/**
 * Deterministic body identity. A star's catalogue designation and its planets'
 * letters are pure functions of where the body sits in the universe hierarchy
 * (world seed → sector → cell → orbital order) plus the star's physical class,
 * so they need no persistence: regenerating a sector reproduces the same names.
 */

import type { ComponentDef } from '@pierre/ecs/component-store';

import type { SpectralClass } from './stars';

import { simpleComponent } from '@pierre/ecs/component-store';

/** A body's display name, attached to its entity for the HUD and labels. */
export interface BodyName {
  name: string;
}

export const NameDef: ComponentDef<BodyName> = simpleComponent<BodyName>('name', {
  name: 'string',
});

// A catalogue number is a fixed-width base-36 designation; five digits give
// ~60M distinct ids, plenty for the systems on screen at once (name collisions
// are cosmetic, never identity keys).
const CATALOG_DIGITS = 5;
const CATALOG_SPACE = 36 ** CATALOG_DIGITS;

// Exoplanet convention: the star is component 'A', so orbiting planets take
// lowercase letters from 'b' outward by orbital order ('b' = 98 in ASCII).
const FIRST_PLANET_CHAR = 98;

/** Render a system hash as a zero-padded, uppercase base-36 catalogue number. */
export function catalogNumber(hash: number): string {
  return (hash % CATALOG_SPACE).toString(36).toUpperCase().padStart(CATALOG_DIGITS, '0');
}

/**
 * A star's catalogue designation: its spectral class, then a catalogue number
 * derived from the system hash — e.g. `G-4F2A9`. The class prefix ties the name
 * to the star's physical type; the hash ties it to its place in the universe.
 */
export function nameStar(spectralClass: SpectralClass, systemHash: number): string {
  return `${spectralClass}-${catalogNumber(systemHash)}`;
}

/** A galaxy's catalogue designation from its cell hash, e.g. `NGC-4F2A9`. */
export function nameGalaxy(galaxyHash: number): string {
  return `NGC-${catalogNumber(galaxyHash)}`;
}

/** The orbital letter for the `index`-th planet (innermost = 0 → 'b'). */
export function planetSuffix(index: number): string {
  return String.fromCharCode(FIRST_PLANET_CHAR + index);
}

/** A planet's name: its star's designation plus the orbital letter, e.g. `G-4F2A9 b`. */
export function namePlanet(starName: string, index: number): string {
  return `${starName} ${planetSuffix(index)}`;
}
