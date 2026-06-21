/**
 * Deterministic integer hashing for per-cell seeds. The whole universe is a
 * pure function of `(worldSeed, coords)`, so generation only needs a stable way
 * to fold coordinates into a 32-bit seed for `makeSeededRng`.
 */

function mix(input: number): number {
  let h = input >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B);
  h = Math.imul(h ^ (h >>> 16), 0x45D9F3B);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold a world seed and integer sector coordinates into a uint32 seed. */
export function hashSector(worldSeed: number, sx: number, sy: number): number {
  let h = (worldSeed ^ 0x9E3779B9) >>> 0;
  h = mix(h ^ (sx | 0));
  h = mix(h ^ ((sy | 0) + 0x85EBCA77));
  return h >>> 0;
}
