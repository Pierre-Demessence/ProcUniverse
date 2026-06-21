/**
 * Blackbody (star) colour as a function of temperature. A star's colour is a
 * real, physical quantity: the colour of a blackbody at its surface
 * temperature (Planck spectrum → CIE XYZ → sRGB). Rather than recompute that
 * integral, we interpolate Mitchell Charity's tabulated `bbr_color` dataset
 * (sRGB, 2° observer) — the standard reference for "what colour are the
 * stars?". See docs/research/realistic-simulation.md §4.4.
 */

interface ColorAnchor {
  b: number;
  g: number;
  r: number;
  t: number;
}

/**
 * Anchor points sampled from Mitchell Charity's `bbr_color.txt` (sRGB). Colours
 * run from deep orange (cool M dwarfs) through warm white (the Sun, ~5800 K) to
 * blue (hot O/B stars). Kept sorted ascending by temperature for the bracketing
 * search in {@link blackbodyColor}.
 */
const ANCHORS: readonly ColorAnchor[] = [
  { b: 0x69, g: 0xB9, r: 0xFF, t: 3000 },
  { b: 0x89, g: 0xC9, r: 0xFF, t: 3500 },
  { b: 0xA1, g: 0xD5, r: 0xFF, t: 4000 },
  { b: 0xCC, g: 0xE7, r: 0xFF, t: 5000 },
  { b: 0xE7, g: 0xF1, r: 0xFF, t: 5800 },
  { b: 0xFB, g: 0xF9, r: 0xFF, t: 6500 },
  { b: 0xFF, g: 0xEF, r: 0xEE, t: 7500 },
  { b: 0xFF, g: 0xDA, r: 0xCF, t: 10000 },
  { b: 0xFF, g: 0xC9, r: 0xB7, t: 15000 },
  { b: 0xFF, g: 0xC1, r: 0xAD, t: 20000 },
  { b: 0xFF, g: 0xBA, r: 0xA5, t: 30000 },
];

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number): string =>
    Math.round(value).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The sRGB hex colour of a blackbody at `tempK` kelvin, interpolated between
 * the tabulated anchors. Temperatures outside the table clamp to its ends
 * (the colour curve is nearly flat beyond ~30,000 K and below ~3,000 K).
 */
export function blackbodyColor(tempK: number): string {
  const first = ANCHORS[0];
  if (tempK <= first.t)
    return toHex(first.r, first.g, first.b);

  const last = ANCHORS[ANCHORS.length - 1];
  if (tempK >= last.t)
    return toHex(last.r, last.g, last.b);

  for (let i = 1; i < ANCHORS.length; i++) {
    const hi = ANCHORS[i];
    if (tempK <= hi.t) {
      const lo = ANCHORS[i - 1];
      const f = (tempK - lo.t) / (hi.t - lo.t);
      return toHex(
        lo.r + (hi.r - lo.r) * f,
        lo.g + (hi.g - lo.g) * f,
        lo.b + (hi.b - lo.b) * f,
      );
    }
  }

  return toHex(last.r, last.g, last.b);
}
