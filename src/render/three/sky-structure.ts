/**
 * Large-scale structure of the background sky seen from inside a galaxy disk:
 * the (wavy) galactic band, patchy star clouds along it, dark dust lanes and the
 * bulge toward the core. Evaluated on unit world directions (galactic plane at
 * z = 0) and baked into a small equirectangular map that is the single source
 * of truth for BOTH the diffuse band glow (GPU) and the star density (CPU), so
 * the two always agree.
 *
 * Pure maths, no Three.js. See docs/plans/starfield-band-structure.md.
 */

/**
 * Gaussian half-width of the galactic band, in units of the out-of-plane
 * direction cosine (|z| ∈ [0,1]). Larger = a wider, softer band and a gentler
 * star-density gradient.
 */
const BAND_SIGMA = 0.25;
/** Max out-of-plane offset of the band centre line (makes its edges wavy). */
const BAND_WARP = 0.07;
const WARP_SCALE = 2.5;

/** Star-cloud noise frequency (cycles per radian, roughly) and contrast. */
const CLOUD_SCALE = 5;
const CLOUD_CONTRAST = 3;

/** Bulge half-widths (radians) along the plane and out of it. */
const BULGE_SIGMA_ALONG = 0.35;
const BULGE_SIGMA_UP = 0.2;

/** Dust: filament noise frequency, ridge threshold, and the thin layer it lives in. */
const DUST_SCALE = 7;
const DUST_THRESHOLD = 0.8;
const DUST_LAYER_SIGMA = 0.09;
/** Low-frequency mask so lanes come in stretches rather than everywhere. */
const DUST_PATCH_SCALE = 2;

/** Beyond this |z| the band warp, clouds, bulge and dust are negligible (skipped). */
const EMPTY_SKY_Z = 0.75;

export const SKY_MAP_WIDTH = 512;
export const SKY_MAP_HEIGHT = 256;

export interface SkyContext {
  /** Unit toward-core direction in the galactic plane (world x/y). */
  coreX: number;
  coreY: number;
  /** Noise seed (per universe seed + galaxy). */
  seed: number;
}

/** All channels in [0, 1]. */
export interface SkySample {
  /** Bulge weight: 1 toward the core. */
  bulge: number;
  /** Star-cloud clumpiness (0.5 = average). */
  cloud: number;
  /** Band weight: 1 on the (warped) plane, easing to 0 toward the poles. */
  disk: number;
  /** Dust opacity. */
  dust: number;
}

/** Equirectangular map: RGBA8 = cloud, dust, bulge, disk. Row 0 is the north (+z) edge. */
export interface SkyMap {
  data: Uint8Array;
  height: number;
  width: number;
}

// ── Equirectangular convention ─────────────────────────────────────────────

/** Map an equirectangular pixel (px, py) of a `width × height` map to a unit direction. */
export function pixelToDir(px: number, py: number, width: number, height: number): { x: number; y: number; z: number } {
  // px → azimuth ∈ [0, 2π), py → elevation from +π/2 (row 0) down to −π/2.
  const azimuth = (px / width) * Math.PI * 2;
  const elevation = (0.5 - py / height) * Math.PI;
  const cosEl = Math.cos(elevation);
  return {
    x: Math.cos(azimuth) * cosEl,
    y: Math.sin(azimuth) * cosEl,
    z: Math.sin(elevation),
  };
}

/** Inverse of `pixelToDir` in normalized texture coordinates (u ∈ [0,1), v ∈ [0,1]). */
export function dirToUv(x: number, y: number, z: number): { u: number; v: number } {
  let u = Math.atan2(y, x) / (Math.PI * 2);
  if (u < 0)
    u += 1;
  const v = 0.5 - Math.asin(Math.min(1, Math.max(-1, z))) / Math.PI;
  return { u, v };
}

// ── Seeded 3D value noise ──────────────────────────────────────────────────

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x27D4EB2D) ^ Math.imul(y, 0x165667B1) ^ Math.imul(z, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
    lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy),
    fz,
  );
}

/** Fractal (octave-summed) value noise, normalized to [0, 1] with mean ≈ 0.5. */
export function fbm(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, z * freq, seed + o * 0x3C6EF372);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Structure field ────────────────────────────────────────────────────────

/** Evaluate the sky structure for a unit world direction. */
export function skyStructure(x: number, y: number, z: number, ctx: SkyContext): SkySample {
  if (Math.abs(z) > EMPTY_SKY_Z)
    return { bulge: 0, cloud: 0.5, disk: Math.exp(-(z * z) / (BAND_SIGMA * BAND_SIGMA)), dust: 0 };
  const s = ctx.seed;
  const warp = (fbm(x * WARP_SCALE, y * WARP_SCALE, z * WARP_SCALE, s ^ 0x1B873593, 3) - 0.5) * 2 * BAND_WARP;
  const zw = z + warp;
  const disk = Math.exp(-(zw * zw) / (BAND_SIGMA * BAND_SIGMA));

  const ring = Math.hypot(x, y) || 1;
  const cosAlong = (x * ctx.coreX + y * ctx.coreY) / ring;
  const sinAlong = (y * ctx.coreX - x * ctx.coreY) / ring;
  const along = Math.atan2(sinAlong, cosAlong);
  const bulge = Math.exp(-((along / BULGE_SIGMA_ALONG) ** 2) - ((zw / BULGE_SIGMA_UP) ** 2));

  const n = fbm(x * CLOUD_SCALE, y * CLOUD_SCALE, z * CLOUD_SCALE, s ^ 0x7FEB352D, 3);
  const cloud = clamp01((n - 0.5) * CLOUD_CONTRAST + 0.5);

  let dust = 0;
  const layer = Math.exp(-(zw * zw) / (DUST_LAYER_SIGMA * DUST_LAYER_SIGMA));
  if (layer > 0.01) {
    const d = fbm(x * DUST_SCALE, y * DUST_SCALE, z * DUST_SCALE, s ^ 0x68E31DA4, 3);
    // Ridged: 1 along the noise's mid-level contour → thin winding filaments.
    const ridge = 1 - Math.abs(2 * d - 1);
    const patch = fbm(x * DUST_PATCH_SCALE, y * DUST_PATCH_SCALE, z * DUST_PATCH_SCALE, s ^ 0x2545F491, 2);
    const patchMask = clamp01((patch - 0.4) / 0.2);
    // Dust is thickest in the core-ward half of the sky, as seen from the disk.
    const coreward = 0.4 + 0.6 * (cosAlong * 0.5 + 0.5);
    dust = clamp01((ridge - DUST_THRESHOLD) / (1 - DUST_THRESHOLD)) * layer * patchMask * coreward;
  }
  return { bulge, cloud, disk, dust };
}

/** Bake the structure into an equirectangular map (texel centres). */
export function bakeSkyStructure(ctx: SkyContext, width = SKY_MAP_WIDTH, height = SKY_MAP_HEIGHT): SkyMap {
  const data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const d = pixelToDir(px + 0.5, py + 0.5, width, height);
      const sample = skyStructure(d.x, d.y, d.z, ctx);
      const i = (py * width + px) * 4;
      data[i] = Math.round(sample.cloud * 255);
      data[i + 1] = Math.round(sample.dust * 255);
      data[i + 2] = Math.round(sample.bulge * 255);
      data[i + 3] = Math.round(sample.disk * 255);
    }
  }
  return { data, height, width };
}

/**
 * Bilinearly sample a baked map for a unit direction, matching GPU texture
 * sampling (linear filter, repeat in u, clamp in v, texel centres). Writes into
 * `out` (hot path: called for every star candidate).
 */
export function sampleSkyMap(map: SkyMap, x: number, y: number, z: number, out: SkySample): SkySample {
  const { data, height, width } = map;
  const { u, v } = dirToUv(x, y, z);
  const fx = u * width - 0.5;
  const fy = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = (x0 + width) % width;
  const xb = (xa + 1) % width;
  const yb = Math.min(height - 1, y0 + 1);
  const i00 = (y0 * width + xa) * 4;
  const i10 = (y0 * width + xb) * 4;
  const i01 = (yb * width + xa) * 4;
  const i11 = (yb * width + xb) * 4;
  const w00 = (1 - tx) * (1 - ty) / 255;
  const w10 = tx * (1 - ty) / 255;
  const w01 = (1 - tx) * ty / 255;
  const w11 = tx * ty / 255;
  const ch = (c: number): number =>
    (data[i00 + c] ?? 0) * w00 + (data[i10 + c] ?? 0) * w10 + (data[i01 + c] ?? 0) * w01 + (data[i11 + c] ?? 0) * w11;
  out.cloud = ch(0);
  out.dust = ch(1);
  out.bulge = ch(2);
  out.disk = ch(3);
  return out;
}
