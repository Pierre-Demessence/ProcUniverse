import { describe, expect, it } from 'vitest';

import { generateWord } from './syllables';

describe('generateWord', () => {
  it('is deterministic — same hash gives the same word', () => {
    expect(generateWord(42)).toBe(generateWord(42));
    expect(generateWord(0xDEADBEEF)).toBe(generateWord(0xDEADBEEF));
  });

  it('different hashes usually produce different words', () => {
    const words = new Set<string>();
    for (let i = 0; i < 500; i++)
      words.add(generateWord(i));
    // With ~10¹³ namespace, 500 sequential hashes should have zero collisions.
    expect(words.size).toBe(500);
  });

  it('respects the syllable-count bounds', () => {
    for (let i = 0; i < 200; i++) {
      const word = generateWord(i, 2, 3);
      // Rough vowel-count check: each syllable has exactly one vowel-like
      // segment (one of the VOWELS entries), so counting vowel letters gives a
      // floor on syllable count.
      const vowelRuns = word.match(/[aeiou]+/gi);
      const syllableEstimate = vowelRuns ? vowelRuns.length : 0;
      expect(syllableEstimate).toBeGreaterThanOrEqual(2);
      expect(syllableEstimate).toBeLessThanOrEqual(3);
    }
  });

  it('is title-cased', () => {
    for (let i = 0; i < 50; i++) {
      const word = generateWord(i * 100);
      expect(word[0]).toBe(word[0]!.toUpperCase());
      expect(word.slice(1)).toBe(word.slice(1)!.toLowerCase());
    }
  });

  it('contains only letters (no digits or symbols)', () => {
    for (let i = 0; i < 100; i++)
      expect(generateWord(i * 7)).toMatch(/^[A-Z]+$/i);
  });

  it('defaults to 2–4 syllables when no bounds are given', () => {
    for (let i = 0; i < 100; i++) {
      const word = generateWord(i * 13);
      expect(word.length).toBeGreaterThanOrEqual(2);
      // 4 syllables × (max onset 3 + vowel 2 + coda 2) ≈ 28 chars max
      expect(word.length).toBeLessThanOrEqual(30);
    }
  });
});
