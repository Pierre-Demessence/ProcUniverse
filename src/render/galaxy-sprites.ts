import { clamp, lerp } from '@pierre/ecs/modules/math';

// Population colour ramp: old / quiescent regions (activity → 0) read red,
// star-forming arms (→ 1) read blue, through a warm white midpoint. Shared by
// the galaxy density glow, the galaxy-field sprites and the starfield so all
// tiers agree.
const RAMP_BUCKETS = 6;
const POP_WARM: [number, number, number] = [255, 176, 112];
const POP_MID: [number, number, number] = [255, 240, 224];
const POP_COLD: [number, number, number] = [159, 192, 255];

/** Population colour at activity `t` ∈ [0, 1]: red (old) → white → blue (young). */
export function populationColor(t: number): [number, number, number] {
  if (t < 0.5) {
    const k = t / 0.5;
    return [lerp(POP_WARM[0], POP_MID[0], k), lerp(POP_WARM[1], POP_MID[1], k), lerp(POP_WARM[2], POP_MID[2], k)];
  }
  const k = (t - 0.5) / 0.5;
  return [lerp(POP_MID[0], POP_COLD[0], k), lerp(POP_MID[1], POP_COLD[1], k), lerp(POP_MID[2], POP_COLD[2], k)];
}

/** Population colour at activity `t` ∈ [0, 1] as a CSS `rgb(...)` string. */
export function populationColorCss(t: number): string {
  const [r, g, b] = populationColor(t);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Population colour quantized to a handful of buckets, so neighbouring galaxies
 * and glow cells of similar activity share one exact tint.
 */
export function bucketedPopulationColor(t: number): [number, number, number] {
  const bucket = clamp(Math.round(t * (RAMP_BUCKETS - 1)), 0, RAMP_BUCKETS - 1);
  return populationColor(bucket / (RAMP_BUCKETS - 1));
}
