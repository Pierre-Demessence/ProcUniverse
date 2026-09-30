/**
 * Procedural galaxy-aware background starfield — a camera-locked skybox whose
 * star density and colour follow the local galaxy structure.
 *
 * Stars are rendered as camera-facing instanced sprite quads (crisp at any zoom
 * / field of view), generated once per galaxy and cached. A small baked
 * sky-structure map (band, star clouds, dust lanes, bulge — see
 * `sky-structure.ts`) drives both the star density and the diffuse "Milky Way"
 * glow, which a node material shades with extra fine grain. The whole dome is
 * recentred on the camera and scaled inside its near/far range each frame by the
 * renderer (see `place`).
 *
 * Workstream C of docs/plans/system-visuals.md.
 * See docs/plans/done/background-starfield.md and
 * docs/plans/starfield-band-structure.md.
 */

import type { UniformNode } from 'three/webgpu';

import type { SkyMap, SkySample } from './sky-structure';

import { AdditiveBlending, BackSide, CanvasTexture, Color, DataTexture, DoubleSide, Group, InstancedMesh, LinearFilter, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RepeatWrapping, SphereGeometry, Vector3 } from 'three';
import { asin, atan, float, mix, mx_fractal_noise_float, positionLocal, texture, uniform, vec2, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import { galaxySampleAt } from '../../generation/galaxies';
import { populationColor } from '../galaxy-sprites';
import { bakeSkyStructure, sampleSkyMap, SKY_MAP_HEIGHT, SKY_MAP_WIDTH } from './sky-structure';

// ── Dome geometry ───────────────────────────────────────────────────────────
// Unit sphere: the renderer scales + recentres it on the camera every frame so
// its radius always sits inside the active camera's near/far range (a fixed
// huge radius would fall beyond the system-tier far plane and be clipped away).
const DOME_RADIUS = 1;
const DOME_SEGMENTS = 64;

// ── Star generation ─────────────────────────────────────────────────────────
/** Number of candidate stars sampled across the whole sky (rejection-sampled). */
const STAR_ATTEMPTS = 180000;
/** Minimum star brightness (0–1). */
const STAR_DIM = 0.25;
/** Brightness variation range. */
const STAR_BRIGHT_RANGE = 0.75;
/**
 * Skew of the brightness draw (`u ** k`). A real sky is dominated by faint stars
 * with only a handful of bright ones; higher = fewer bright stars.
 */
const STAR_BRIGHT_EXPONENT = 3;
/**
 * Brightness above which a star's intensity is boosted past the system-tier
 * bloom threshold, so the bloom pass gives the brightest few a soft halo.
 */
const STAR_HALO_START = 0.99;
/** Intensity of the very brightest star (bloom threshold is 1.5). */
const STAR_HALO_PEAK = 2.5;
/** Sprite size multipliers for the faintest / brightest star. */
const STAR_SIZE_MIN = 0.7;
const STAR_SIZE_MAX = 2;
/** Half-width of the per-star colour spread around white on the population ramp. */
const STAR_TINT_SPREAD = 0.5;
/** How strongly the local galaxy activity leans star colours warm / cold. */
const STAR_REGION_BIAS = 0.3;
/**
 * Angular size of a star sprite (~radians it subtends). On-screen pixel size is
 * roughly this times `viewportH / (2·tan(fov/2))`, independent of the dome
 * radius since every star sits at the same distance from the camera.
 */
const STAR_ANGULAR_SIZE = 0.003;
/**
 * Sparse ambient star probability far from the galactic plane, so the poles read
 * as a few scattered foreground stars rather than empty black (or, as before, a
 * uniform 5% field). Kept small so the plane→pole gradient stays visible.
 */
const STAR_AMBIENT = 0.05;
/** Star-density multiplier in the sparsest / densest star clouds (mean ≈ 1). */
const STAR_CLOUD_MIN = 0.3;
const STAR_CLOUD_MAX = 1.7;
/** Fraction of galaxy stars hidden behind fully opaque dust. */
const DUST_STAR_OPACITY = 0.85;
/** Extra star density at the bulge peak (fractional). */
const BULGE_STAR_BOOST = 1;

// ── Open clusters ───────────────────────────────────────────────────────────
const CLUSTER_COUNT = 10;
const CLUSTER_STARS_MIN = 20;
const CLUSTER_STARS_MAX = 80;
/** Cluster Gaussian radius range (radians, ≈ 0.3°–1.4°). */
const CLUSTER_RADIUS_MIN = 0.005;
const CLUSTER_RADIUS_MAX = 0.025;
/** Out-of-plane spread of cluster centres (direction cosine). */
const CLUSTER_Z_SPREAD = 0.12;
/** Clusters are not placed where dust would hide them. */
const CLUSTER_MAX_DUST = 0.4;
/** Instance capacity: every candidate plus the largest possible cluster set. */
const STAR_CAPACITY = STAR_ATTEMPTS + CLUSTER_COUNT * CLUSTER_STARS_MAX;

// ── Milky Way band ──────────────────────────────────────────────────────────
/** Band glow on the plane in an average star cloud. */
const BAND_BRIGHTNESS = 0.06;
/** Extra glow at the bulge peak. */
const BULGE_BRIGHTNESS = 0.12;
/** Band glow left in the sparsest star cloud (fraction of the densest). */
const CLOUD_GLOW_FLOOR = 0.25;
/** How much fully opaque dust darkens the band glow. */
const DUST_GLOW_OPACITY = 0.9;
/** GPU fine-grain noise over the band: frequency (per radian) and strength. */
const FINE_DETAIL_SCALE = 60;
const FINE_DETAIL_AMOUNT = 0.5;
/** Band tint away from the core / in the bulge (raw sRGB). */
const BAND_COOL: [number, number, number] = [0.65, 0.7, 0.85];
const BAND_WARM: [number, number, number] = [1, 0.82, 0.55];

// ── Public interface ────────────────────────────────────────────────────────

export interface StarfieldGalaxy {
  /** Absolute galaxy centre (AU), in the same frame as the camera position. */
  centerX: number;
  centerY: number;
  orientation: number;
  void: boolean;
}

export interface StarfieldDome {
  object: Group;
  /** True once `update` has filled the dome for some galaxy context. */
  readonly populated: boolean;
  dispose: () => void;
  /**
   * Recentre the dome on the camera and scale it to the given render-space
   * radius.  The dome moves with the camera (a sky has no parallax) and its
   * radius must fall inside the camera's near/far range to avoid clipping.
   * Star points keep a constant on-screen size regardless of the scale.
   */
  place: (x: number, y: number, z: number, radius: number) => void;
  /**
   * Fade the dome's point stars (0–1) while keeping the band glow: at the star
   * tier real neighbour stars fill the foreground, so the statistical ones fade.
   */
  setStarOpacity: (opacity: number) => void;
  /** Show or hide the dome (hidden on the top-down map tiers). */
  setVisible: (visible: boolean) => void;
  /**
   * Update the star points for the given galaxy context and camera position.
   * The geometry is regenerated only when the galaxy changes.
   * `seed` is the universe seed; `camWorldX`/`camWorldY` are absolute AU.
   */
  update: (seed: number, galaxy: StarfieldGalaxy, camWorldX: number, camWorldY: number) => void;
}

// ── Texture cache ───────────────────────────────────────────────────────────
const starCache = new Map<string, StarData>();
const CACHE_MAX = 8;

/**
 * Per-galaxy star cloud: flat unit directions (xyz), colours (rgb, brightness
 * pre-multiplied; can exceed 1 for halo stars) and sprite scales, plus the sky
 * structure map they were placed from (null in the void: no band).
 */
interface StarData {
  colors: Float32Array;
  count: number;
  dirs: Float32Array;
  sizes: Float32Array;
  sky: SkyMap | null;
}

function cacheKey(seed: number, galaxy: StarfieldGalaxy, camWorldX: number, camWorldY: number): string {
  if (galaxy.void)
    return `void:${seed}`;
  // The toward-core direction depends on camera position, so include a coarse
  // quadrant in the key (regenerates every ~50 kAU of travel).
  const qx = Math.round(camWorldX / 50000);
  const qy = Math.round(camWorldY / 50000);
  return `gal:${seed}:${galaxy.centerX.toFixed(0)},${galaxy.centerY.toFixed(0)}:${qx},${qy}`;
}

// ── Per-star appearance ─────────────────────────────────────────────────────

/** Star brightness in [STAR_DIM, STAR_DIM + STAR_BRIGHT_RANGE) from a uniform `u` ∈ [0,1). */
export function starBrightness(u: number): number {
  return STAR_DIM + STAR_BRIGHT_RANGE * u ** STAR_BRIGHT_EXPONENT;
}

/** Colour multiplier: equal to `bright`, ramping up to STAR_HALO_PEAK over the top tail. */
export function starIntensity(bright: number): number {
  if (bright <= STAR_HALO_START)
    return bright;
  const k = (bright - STAR_HALO_START) / (1 - STAR_HALO_START);
  return bright + k * (STAR_HALO_PEAK - 1);
}

/** Sprite angular size: brighter stars read larger. */
export function starScale(bright: number): number {
  const norm = Math.min(1, Math.max(0, (bright - STAR_DIM) / STAR_BRIGHT_RANGE));
  return STAR_ANGULAR_SIZE * (STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * norm);
}

/**
 * Position on the warm → white → cold population ramp for one star. Two
 * uniforms form a triangular draw peaking at white, so most stars are
 * white-ish with occasional orange / blue-white ones; `activity` only leans it.
 */
export function starTint(u1: number, u2: number, activity: number): number {
  const t = 0.5 + STAR_TINT_SPREAD * (u1 - u2) + STAR_REGION_BIAS * (activity - 0.5);
  return Math.min(1, Math.max(0, t));
}

// ── Sprite texture ──────────────────────────────────────────────────────────

/** A small soft round dot used as the point sprite so stars are crisp circles. */
function makeDotTexture(): CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = 'srgb';
  return texture;
}

// ── Star generation ─────────────────────────────────────────────────────────

/** Per-galaxy seed, so every galaxy's sky (stars + structure) is distinct but stable. */
function galaxySeed(seed: number, galaxy: StarfieldGalaxy): number {
  let state = seed ^ 0x5EEDF1D0;
  if (!galaxy.void)
    state ^= Math.round(galaxy.centerX) ^ (Math.round(galaxy.centerY) << 13);
  return state;
}

/**
 * Build the per-galaxy star cloud: a rejection-sampled set of unit-length
 * directions whose density and colour follow the galaxy density / activity math
 * and the baked sky structure (clouds, dust, bulge), plus a few open clusters,
 * with each star's brightness pre-multiplied into its colour (additive blend).
 */
function generateStars(
  seed: number,
  galaxy: StarfieldGalaxy,
  camWorldX: number,
  camWorldY: number,
): StarData {
  // Simple seeded PRNG (Mulberry32) keyed to the galaxy so the sky is stable.
  let state = galaxySeed(seed, galaxy);
  const rand = (): number => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // "Toward core" direction in the world frame (denser stars facing the core).
  let toCoreWx = 1;
  let toCoreWy = 0;
  if (!galaxy.void) {
    const dcx = galaxy.centerX - camWorldX;
    const dcy = galaxy.centerY - camWorldY;
    const dLen = Math.hypot(dcx, dcy) || 1;
    toCoreWx = dcx / dLen;
    toCoreWy = dcy / dLen;
  }

  const PROBE_DIST = 50000; // AU (~0.8 ly — probes the local spiral structure)

  const sky = galaxy.void ? null : bakeSkyStructure({ coreX: toCoreWx, coreY: toCoreWy, seed: state });
  const skySample: SkySample = { bulge: 0, cloud: 0.5, disk: 0, dust: 0 };

  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const pushStar = (dx: number, dy: number, dz: number, bright: number, tint: number): void => {
    const intensity = starIntensity(bright);
    const [cr, cg, cb] = populationColor(tint);
    positions.push(dx, dy, dz);
    // Colour pre-multiplied by intensity (additive blending sums contributions).
    colors.push((cr / 255) * intensity, (cg / 255) * intensity, (cb / 255) * intensity);
    sizes.push(starScale(bright));
  };
  for (let i = 0; i < STAR_ATTEMPTS; i++) {
    // Uniform direction on the unit sphere (avoids equirectangular pole clumping).
    const z = 2 * rand() - 1;
    const azimuth = rand() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const dx = ring * Math.cos(azimuth);
    const dy = ring * Math.sin(azimuth);

    const towardCore = (dx * toCoreWx + dy * toCoreWy) * 0.5 + 0.5;
    const coreFactor = towardCore * 0.55 + 0.45;

    const probeX = camWorldX + dx * PROBE_DIST;
    const probeY = camWorldY + dy * PROBE_DIST;

    let density: number;
    let activity: number;
    if (galaxy.void) {
      density = 0.12;
      activity = 0.5;
    }
    else {
      const sample = galaxySampleAt(seed, probeX, probeY);
      const structure = sky ? sampleSkyMap(sky, dx, dy, z, skySample) : skySample;
      // The (wavy) band sets the plane → pole gradient; star clouds and the bulge
      // clump it, dust hides what lies behind. A small ambient floor of
      // foreground stars keeps the poles from reading as empty black.
      const cloud = STAR_CLOUD_MIN + (STAR_CLOUD_MAX - STAR_CLOUD_MIN) * structure.cloud;
      const galactic = sample.density * coreFactor * structure.disk * cloud * (1 + BULGE_STAR_BOOST * structure.bulge);
      density = Math.min(0.95, STAR_AMBIENT + galactic * (1 - DUST_STAR_OPACITY * structure.dust));
      activity = sample.activity * 0.3 + coreFactor * 0.7;
    }

    // Rejection sampling: keep the star with probability proportional to density.
    if (rand() >= density)
      continue;

    pushStar(dx, dy, z, starBrightness(rand()), starTint(rand(), rand(), activity));
  }

  if (sky)
    addClusters(sky, skySample, rand, pushStar);

  return {
    colors: new Float32Array(colors),
    count: positions.length / 3,
    dirs: new Float32Array(positions),
    sizes: new Float32Array(sizes),
    sky,
  };
}

/**
 * Scatter a few open clusters near the galactic plane: tight Gaussian knots of
 * young stars, brighter and bluer than the field, skipped where dust would hide
 * them.
 */
function addClusters(
  sky: SkyMap,
  scratch: SkySample,
  rand: () => number,
  pushStar: (dx: number, dy: number, dz: number, bright: number, tint: number) => void,
): void {
  for (let c = 0; c < CLUSTER_COUNT; c++) {
    const cz = (rand() * 2 - 1) * CLUSTER_Z_SPREAD;
    const az = rand() * Math.PI * 2;
    const ring = Math.sqrt(1 - cz * cz);
    const cosAz = Math.cos(az);
    const sinAz = Math.sin(az);
    const cx = ring * cosAz;
    const cy = ring * sinAz;
    const radius = CLUSTER_RADIUS_MIN + (CLUSTER_RADIUS_MAX - CLUSTER_RADIUS_MIN) * rand();
    const members = Math.floor(CLUSTER_STARS_MIN + (CLUSTER_STARS_MAX - CLUSTER_STARS_MIN) * rand());
    if (sampleSkyMap(sky, cx, cy, cz, scratch).dust > CLUSTER_MAX_DUST)
      continue;
    // Tangent basis at the centre: east = (−sin az, cos az, 0), north = (−z cos az, −z sin az, ring).
    for (let m = 0; m < members; m++) {
      // Box–Muller radius → a 2D Gaussian offset of standard deviation `radius`.
      const r = radius * Math.sqrt(-2 * Math.log(1 - rand()));
      const theta = rand() * Math.PI * 2;
      const east = r * Math.cos(theta);
      const north = r * Math.sin(theta);
      const px = cx - sinAz * east - cz * cosAz * north;
      const py = cy + cosAz * east - cz * sinAz * north;
      const pz = cz + ring * north;
      const len = Math.hypot(px, py, pz);
      // Square-root skew pushes members toward the bright end.
      pushStar(px / len, py / len, pz / len, starBrightness(Math.sqrt(rand())), starTint(rand(), rand(), 1));
    }
  }
}

// ── Band material ───────────────────────────────────────────────────────────

/**
 * Additive glow for the Milky-Way band: the baked structure map gives the band,
 * star clouds, bulge and dust; GPU noise adds grain finer than a map texel. The
 * sky's angular scale never changes (fixed FOV), so per-pixel noise can't shimmer.
 */
function createBandMaterial(skyTexture: DataTexture, grainOffset: UniformNode<'vec3', Vector3>): MeshBasicNodeMaterial {
  const dir = positionLocal.normalize();
  // Inverse of `pixelToDir` (see `dirToUv`): u = azimuth / 2π, v = 0.5 − elevation / π.
  const skyUv = vec2(
    atan(dir.y, dir.x).div(Math.PI * 2).fract(),
    float(0.5).sub(asin(dir.z.clamp(-1, 1)).div(Math.PI)),
  );
  const sky = texture(skyTexture, skyUv);
  const cloud = sky.r;
  const dust = sky.g;
  const bulge = sky.b;
  const disk = sky.a;
  const grain = mx_fractal_noise_float(dir.mul(FINE_DETAIL_SCALE).add(grainOffset), 3).mul(FINE_DETAIL_AMOUNT).add(1).max(0);
  const bandGlow = disk.mul(mix(float(CLOUD_GLOW_FLOOR), float(1), cloud)).mul(BAND_BRIGHTNESS);
  const dustTransmission = dust.mul(DUST_GLOW_OPACITY).oneMinus();
  const glow = bandGlow.add(bulge.mul(BULGE_BRIGHTNESS)).mul(dustTransmission).mul(grain);
  const tint = mix(vec3(...BAND_COOL), vec3(...BAND_WARM), bulge.sqrt());

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: BackSide,
    transparent: true,
  });
  material.colorNode = tint.mul(glow);
  return material;
}

// ── Public factory ──────────────────────────────────────────────────────────

export function createStarfieldDome(): StarfieldDome {
  const dotTexture = makeDotTexture();

  // Stars: camera-facing instanced sprite quads (render reliably on both the
  // WebGPU and WebGL2 backends, unlike GPU points which are 1px on WebGPU).
  const starGeometry = new PlaneGeometry(1, 1);
  const starMaterial = new MeshBasicMaterial({
    blending: AdditiveBlending,
    // Depth-test so solid scene content (planets/stars) occludes the sky, but
    // never write depth (the dome must not occlude anything itself). The
    // renderer fits the dome radius just inside the far plane so it sits behind
    // all content.
    depthTest: true,
    depthWrite: false,
    map: dotTexture,
    side: DoubleSide,
    transparent: true,
  });
  const stars = new InstancedMesh(starGeometry, starMaterial, STAR_CAPACITY);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  stars.count = 0;

  // Band: a faint additive glow sphere (BackSide), hidden in the void. It is
  // NOT rotated, so its local position is the world direction the stars use;
  // the shader maps that direction into the sky-structure map with the same
  // equirectangular convention as `sampleSkyMap`.
  const skyTexture = new DataTexture(new Uint8Array(SKY_MAP_WIDTH * SKY_MAP_HEIGHT * 4), SKY_MAP_WIDTH, SKY_MAP_HEIGHT);
  skyTexture.wrapS = RepeatWrapping;
  skyTexture.magFilter = LinearFilter;
  skyTexture.minFilter = LinearFilter;
  skyTexture.generateMipmaps = false;
  const uGrainOffset = uniform(new Vector3());
  const bandMaterial = createBandMaterial(skyTexture, uGrainOffset);
  const bandGeometry = new SphereGeometry(DOME_RADIUS, DOME_SEGMENTS, DOME_SEGMENTS);
  const bandMesh = new Mesh(bandGeometry, bandMaterial);
  bandMesh.frustumCulled = false;
  bandMesh.renderOrder = -1;

  const object = new Group();
  object.name = 'starfield-dome';
  object.add(stars);
  object.add(bandMesh);

  // Scratch objects for composing per-star instance transforms.
  const dummy = new Object3D();
  const forward = new Vector3(0, 0, 1);
  const toCamera = new Vector3();
  const color = new Color();

  // Fill the instanced mesh from a star cloud. Each quad sits on the unit dome
  // and faces the dome centre (= the camera, since the dome is recentred on it),
  // so the sprites always billboard toward the viewer. Its local scale sets the
  // angular size; because every star is equidistant, that reads as a constant
  // on-screen size regardless of the dome's (per-frame) radius.
  const fillStars = (data: StarData): void => {
    for (let i = 0; i < data.count; i++) {
      const dx = data.dirs[i * 3] ?? 0;
      const dy = data.dirs[i * 3 + 1] ?? 0;
      const dz = data.dirs[i * 3 + 2] ?? 0;
      dummy.position.set(dx, dy, dz);
      toCamera.set(-dx, -dy, -dz);
      dummy.quaternion.setFromUnitVectors(forward, toCamera);
      dummy.scale.setScalar(data.sizes[i] ?? STAR_ANGULAR_SIZE);
      dummy.updateMatrix();
      stars.setMatrixAt(i, dummy.matrix);
      color.setRGB(data.colors[i * 3] ?? 0, data.colors[i * 3 + 1] ?? 0, data.colors[i * 3 + 2] ?? 0);
      stars.setColorAt(i, color);
    }
    stars.count = data.count;
    stars.instanceMatrix.needsUpdate = true;
    if (stars.instanceColor)
      stars.instanceColor.needsUpdate = true;
  };

  let disposed = false;
  let lastKey = '';

  return {
    object,
    dispose: () => {
      if (disposed)
        return;
      disposed = true;
      starCache.clear();
      starGeometry.dispose();
      starMaterial.dispose();
      dotTexture.dispose();
      bandGeometry.dispose();
      bandMaterial.dispose();
      skyTexture.dispose();
      stars.dispose();
    },
    place: (x, y, z, radius) => {
      object.position.set(x, y, z);
      object.scale.setScalar(radius);
    },
    get populated() {
      return lastKey !== '';
    },
    setStarOpacity: (opacity) => {
      starMaterial.opacity = opacity;
      stars.visible = opacity > 0;
    },
    setVisible: (visible) => {
      object.visible = visible;
    },
    update: (seed, galaxy, camWorldX, camWorldY) => {
      if (disposed)
        return;
      bandMesh.visible = !galaxy.void;

      const key = cacheKey(seed, galaxy, camWorldX, camWorldY);
      if (key === lastKey)
        return;
      lastKey = key;

      let data = starCache.get(key);
      if (!data) {
        data = generateStars(seed, galaxy, camWorldX, camWorldY);
        // Evict the oldest entry if the cache is full.
        if (starCache.size >= CACHE_MAX) {
          const oldest = starCache.keys().next().value;
          if (oldest !== undefined)
            starCache.delete(oldest);
        }
        starCache.set(key, data);
      }
      fillStars(data);
      if (data.sky) {
        skyTexture.image.data?.set(data.sky.data);
        skyTexture.needsUpdate = true;
        const gs = galaxySeed(seed, galaxy);
        uGrainOffset.value.set((gs & 1023) * 0.37, ((gs >>> 10) & 1023) * 0.37, ((gs >>> 20) & 1023) * 0.37);
      }
    },
  };
}
