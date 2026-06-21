import { LocalStorageBackend } from '@pierre/ecs/modules/save';

const SEED_KEY = 'procuniverse:world-seed';

/** Mint a fresh random uint32 to seed a brand-new universe. */
function mintSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * Resolve the world seed the universe is generated from. The first visit mints
 * a random seed and persists it, so a reload regenerates a byte-identical
 * universe; clearing site storage yields a brand-new one. Storage failures
 * (private mode, insecure context where `crypto.subtle` is unavailable) fall
 * back to a non-persisted random seed rather than blocking startup.
 */
export async function loadOrCreateWorldSeed(): Promise<number> {
  const backend = new LocalStorageBackend();
  try {
    const saved = await backend.load(SEED_KEY);
    if (saved !== null) {
      const parsed = Number(saved);
      if (Number.isInteger(parsed) && parsed >= 0)
        return parsed >>> 0;
    }
    const seed = mintSeed();
    await backend.save(SEED_KEY, String(seed));
    return seed;
  }
  catch {
    return mintSeed();
  }
}
