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

/**
 * Fold a world seed, sector coordinates, and intra-sector cell coordinates into
 * a uint32 that uniquely tags a single system. Independent of the generation
 * rng stream, so deriving a stable catalogue name from it never perturbs the
 * deterministic physics draws.
 */
export function hashSystem(worldSeed: number, sx: number, sy: number, gx: number, gy: number): number {
  let h = (worldSeed ^ 0x9E3779B9) >>> 0;
  h = mix(h ^ (sx | 0));
  h = mix(h ^ ((sy | 0) + 0x85EBCA77));
  h = mix(h ^ ((gx | 0) + 0xC2B2AE35));
  h = mix(h ^ ((gy | 0) + 0x27D4EB2F));
  return h >>> 0;
}

/**
 * Fold a world seed and integer galaxy-cell coordinates into a uint32 galaxy
 * seed, kept distinct from any sector or system hash so a galaxy's shape
 * parameters never collide with a cell's star stream.
 */
export function hashGalaxy(worldSeed: number, gx: number, gy: number): number {
  let h = (worldSeed ^ 0x68E31DA4) >>> 0;
  h = mix(h ^ (gx | 0));
  h = mix(h ^ ((gy | 0) + 0x9E3779B9));
  return h >>> 0;
}

/**
 * Fold a system seed and a planet's orbital index into a uint32 moon seed, kept
 * off the system's physics rng stream so generating a planet's moons never
 * perturbs the star or planet draws (the moons are an independent, order-safe
 * side stream).
 */
export function hashMoon(systemSeed: number, planetIndex: number): number {
  let h = (systemSeed ^ 0x1B56C4E9) >>> 0;
  h = mix(h ^ (planetIndex | 0));
  return h >>> 0;
}
