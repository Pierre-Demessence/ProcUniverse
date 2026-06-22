import { clamp, lerp } from '@pierre/ecs/modules/math';

// Population colour ramp: old / quiescent regions (activity → 0) read red,
// star-forming arms (→ 1) read blue, through a warm white midpoint. Shared by
// the galaxy density glow and the galaxy-field sprites so both tiers agree.
const RAMP_BUCKETS = 6;
const POP_WARM: [number, number, number] = [255, 176, 112];
const POP_MID: [number, number, number] = [255, 240, 224];
const POP_COLD: [number, number, number] = [159, 192, 255];
const glowSprites = new Map<number, HTMLCanvasElement>();

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
 * A cached radial glow sprite tinted by population activity `t` ∈ [0, 1]. The
 * ramp is bucketed so only a handful of sprites are ever built, keeping per-cell
 * and per-galaxy drawing a cheap blit.
 */
export function populationGlow(t: number): HTMLCanvasElement {
  const bucket = clamp(Math.round(t * (RAMP_BUCKETS - 1)), 0, RAMP_BUCKETS - 1);
  const cached = glowSprites.get(bucket);
  if (cached)
    return cached;
  const [r, g, b] = populationColor(bucket / (RAMP_BUCKETS - 1));
  const rgb = `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb}, 1)`);
  grad.addColorStop(0.45, `rgba(${rgb}, 0.4)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowSprites.set(bucket, c);
  return c;
}
