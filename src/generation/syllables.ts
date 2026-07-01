/**
 * Deterministic pronounceable-word generator. A simple LCG turns a uint32 hash
 * into an unlimited sequence of independent picks, so syllable count, onsets,
 * vowels, and codas are all derived from one hash with zero RNG-stream impact.
 * Typical output: 2–4 syllable title-cased words like "Talos", "Korvannis".
 */

const ONSETS = [
  'b',
  'bl',
  'br',
  'c',
  'ch',
  'cl',
  'cr',
  'd',
  'dr',
  'f',
  'fl',
  'fr',
  'g',
  'gl',
  'gr',
  'h',
  'j',
  'k',
  'kl',
  'kr',
  'l',
  'm',
  'n',
  'p',
  'pl',
  'pr',
  'qu',
  'r',
  's',
  'sh',
  'sl',
  'st',
  'str',
  't',
  'th',
  'tr',
  'v',
  'vr',
  'w',
  'z',
] as const;

const VOWELS = [
  'a',
  'e',
  'i',
  'o',
  'u',
  'ae',
  'ai',
  'au',
  'ea',
  'ee',
  'ei',
  'eu',
  'ia',
  'ie',
  'io',
  'oa',
  'oi',
  'oo',
  'ou',
  'ua',
] as const;

const CODAS = [
  '',
  'b',
  'd',
  'g',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'v',
  'x',
  'z',
  'ld',
  'ls',
  'nd',
  'ng',
  'nk',
  'ns',
  'nt',
  'rd',
  'rk',
  'rs',
  'rt',
  'sk',
  'st',
] as const;

/** Simple LCG: returns a 15-bit integer (0..32767) on each call, deterministic from `seed`. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state, 1103515245) + 12345;
    return (state >>> 16) & 0x7FFF;
  };
}

/**
 * Assemble a title-cased word of `minSyllables`–`maxSyllables` syllables from
 * the onset, vowel, and coda inventories. Each decision is drawn from the LCG
 * sequence seeded by `hash`, so the same hash always produces the same word.
 */
export function generateWord(hash: number, minSyllables = 2, maxSyllables = 4): string {
  const next = lcg(hash);
  const count = minSyllables + (next() % (maxSyllables - minSyllables + 1));
  let word = '';
  for (let i = 0; i < count; i++) {
    word += ONSETS[next() % ONSETS.length];
    word += VOWELS[next() % VOWELS.length];
    // 2/3 chance of a coda so most syllables end open → more readable.
    if (next() % 3 !== 0)
      word += CODAS[next() % CODAS.length];
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}
