/**
 * Procedural galaxy-aware background starfield — a camera-locked skybox whose
 * star density and colour follow the local galaxy structure.
 *
 * Stars are rendered as camera-facing instanced sprite quads (crisp at any zoom
 * / field of view), generated once per galaxy and cached; the faint "Milky Way"
 * band is a single shared low-frequency texture (soft by design, so it needs no
 * resolution). The whole dome is recentred on the camera and scaled inside its
 * near/far range each frame by the renderer (see `place`).
 *
 * Workstream C of docs/plans/system-visuals.md.
 * See docs/plans/background-starfield.md for the full plan.
 */

import { AdditiveBlending, CanvasTexture, Color, DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SphereGeometry, Vector3 } from 'three';

import { galaxyActivityAt, galaxyDensityAt } from '../../generation/galaxies';
import { populationColor } from '../galaxy-sprites';

// ── Dome geometry ───────────────────────────────────────────────────────────
// Unit sphere: the renderer scales + recentres it on the camera every frame so
// its radius always sits inside the active camera's near/far range (a fixed
// huge radius would fall beyond the system-tier far plane and be clipped away).
const DOME_RADIUS = 1;
const DOME_SEGMENTS = 64;

// ── Texture resolution (Milky-Way band only) ───────────────────────────────
/** Equirectangular band texture size. Low-frequency, so modest resolution. */
const TEX_W = 2048;
const TEX_H = 1024;

// ── Star generation ─────────────────────────────────────────────────────────
/** Number of candidate stars sampled across the whole sky (rejection-sampled). */
const STAR_ATTEMPTS = 180000;
/** Minimum star brightness (0–1). */
const STAR_DIM = 0.18;
/** Brightness variation range. */
const STAR_BRIGHT_RANGE = 0.82;
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

// ── Milky Way band ─────────────────────────────────────────────────────
/**
 * Gaussian half-width of the galactic band, in units of the out-of-plane
 * direction cosine (|z| ∈ [0,1]). Larger = a wider, softer band and a gentler
 * density gradient. This drives BOTH the star density falloff and the diffuse
 * band texture so they agree.
 */
const BAND_SIGMA = 0.25;
/** Band peak brightness (fractional). */
const BAND_BRIGHTNESS = 0.05;

// ── Public interface ────────────────────────────────────────────────────────

export interface StarfieldGalaxy {
  centerX: number;
  centerY: number;
  orientation: number;
  void: boolean;
}

export interface StarfieldDome {
  object: Group;
  dispose: () => void;
  /**
   * Recentre the dome on the camera and scale it to the given render-space
   * radius.  The dome moves with the camera (a sky has no parallax) and its
   * radius must fall inside the camera's near/far range to avoid clipping.
   * Star points keep a constant on-screen size regardless of the scale.
   */
  place: (x: number, y: number, z: number, radius: number) => void;
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

/** Per-galaxy star cloud: flat unit directions (xyz) and colours (rgb, 0–1). */
interface StarData {
  colors: Float32Array;
  count: number;
  dirs: Float32Array;
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

// ── Direction helpers ───────────────────────────────────────────────────────

/** Map equirectangular pixel (px, py) to a unit direction vector. */
export function pixelToDir(px: number, py: number): { x: number; y: number; z: number } {
  // px ∈ [0, TEX_W) → azimuth ∈ [0, 2π)
  // py ∈ [0, TEX_H) → elevation ∈ [−π/2, π/2]
  const azimuth = (px / TEX_W) * Math.PI * 2;
  const elevation = (0.5 - py / TEX_H) * Math.PI;
  const cosEl = Math.cos(elevation);
  return {
    x: Math.cos(azimuth) * cosEl,
    y: Math.sin(azimuth) * cosEl,
    z: Math.sin(elevation),
  };
}

/**
 * Smooth galactic-plane weight from an out-of-plane direction cosine `z`
 * (|z| ∈ [0,1]): 1 in the plane, easing smoothly to ~0 toward the poles. Used
 * for both the star density falloff and the band texture so they match.
 */
function diskWeight(z: number): number {
  return Math.exp(-(z * z) / (BAND_SIGMA * BAND_SIGMA));
}

// ── Texture generation ──────────────────────────────────────────────────────

// ── Sprite / band textures (shared) ─────────────────────────────────────────

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

/**
 * The faint diffuse "Milky Way" band along the disk plane (texture equator).
 * Low-frequency, so a soft/blurred look is fine and it is the same for every
 * galaxy — generated once and shared. Alpha carries the intensity; the material
 * blends additively, so the black background contributes nothing.
 */
function makeBandTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  const imageData = ctx.getImageData(0, 0, TEX_W, TEX_H);
  const data = imageData.data;
  for (let py = 0; py < TEX_H; py++) {
    const dir = pixelToDir(TEX_W / 2, py);
    const diskFactor = diskWeight(dir.z);
    if (diskFactor < 0.01)
      continue;
    const alpha = Math.round(diskFactor * BAND_BRIGHTNESS * 255);
    for (let px = 0; px < TEX_W; px++) {
      const idx = (py * TEX_W + px) * 4;
      // Warm white-blue; intensity lives in the alpha channel.
      data[idx] = 166;
      data[idx + 1] = 179;
      data[idx + 2] = 217;
      data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = 'srgb';
  texture.generateMipmaps = false;
  return texture;
}

// ── Star generation ─────────────────────────────────────────────────────────

/**
 * Build the per-galaxy star cloud: a rejection-sampled set of unit-length
 * directions whose density and colour follow the galaxy density / activity math,
 * with each star's brightness pre-multiplied into its colour (additive blend).
 */
function generateStars(
  seed: number,
  galaxy: StarfieldGalaxy,
  camWorldX: number,
  camWorldY: number,
): StarData {
  // Simple seeded PRNG (Mulberry32) keyed to the galaxy so the sky is stable.
  let state = seed ^ 0x5EEDF1D0;
  if (!galaxy.void)
    state ^= Math.round(galaxy.centerX) ^ (Math.round(galaxy.centerY) << 13);
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

  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < STAR_ATTEMPTS; i++) {
    // Uniform direction on the unit sphere (avoids equirectangular pole clumping).
    const z = 2 * rand() - 1;
    const azimuth = rand() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const dx = ring * Math.cos(azimuth);
    const dy = ring * Math.sin(azimuth);

    const towardCore = (dx * toCoreWx + dy * toCoreWy) * 0.5 + 0.5;
    const coreFactor = towardCore * 0.55 + 0.45;
    // Smooth disk-plane weight: densest in the plane, easing to ~0 at the poles.
    const diskFactor = diskWeight(z);

    const probeX = camWorldX + dx * PROBE_DIST;
    const probeY = camWorldY + dy * PROBE_DIST;

    let density: number;
    let activity: number;
    if (galaxy.void) {
      density = 0.12;
      activity = 0.5;
    }
    else {
      const rawDensity = galaxyDensityAt(seed, probeX, probeY);
      // Gradient from the plane outward + a small ambient floor (no hard clip),
      // so there is no uniform sprinkle competing with the band.
      density = Math.min(0.95, STAR_AMBIENT + rawDensity * coreFactor * diskFactor);
      const rawActivity = galaxyActivityAt(seed, probeX, probeY);
      activity = rawActivity * 0.3 + coreFactor * 0.7;
    }

    // Rejection sampling: keep the star with probability proportional to density.
    if (rand() >= density)
      continue;

    const bright = STAR_DIM + rand() * STAR_BRIGHT_RANGE;
    const [cr, cg, cb] = populationColor(activity);
    positions.push(dx, dy, z);
    // Colour pre-multiplied by brightness (additive blending sums contributions).
    colors.push((cr / 255) * bright, (cg / 255) * bright, (cb / 255) * bright);
  }

  return {
    colors: new Float32Array(colors),
    count: positions.length / 3,
    dirs: new Float32Array(positions),
  };
}

// ── Public factory ──────────────────────────────────────────────────────────

export function createStarfieldDome(): StarfieldDome {
  const dotTexture = makeDotTexture();
  const bandTexture = makeBandTexture();

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
  const stars = new InstancedMesh(starGeometry, starMaterial, STAR_ATTEMPTS);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  stars.count = 0;

  // Band: a faint additive glow sphere (BackSide), hidden in the void.
  const bandGeometry = new SphereGeometry(DOME_RADIUS, DOME_SEGMENTS, DOME_SEGMENTS);
  const bandMaterial = new MeshBasicMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    map: bandTexture,
    side: 1, // BackSide
    transparent: true,
  });
  const bandMesh = new Mesh(bandGeometry, bandMaterial);
  bandMesh.frustumCulled = false;
  bandMesh.renderOrder = -1;
  // The SphereGeometry pole is +Y and its texture equator (the painted band) is
  // the local XZ plane; rotate -π/2 about X so that band lands on the world XY
  // plane — the galaxy disk — matching the star band. The stars are generated
  // directly in world axes (band at world z=0), so they are NOT rotated.
  bandMesh.rotation.x = -Math.PI / 2;

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
      dummy.scale.setScalar(STAR_ANGULAR_SIZE);
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
      bandTexture.dispose();
      stars.dispose();
    },
    place: (x, y, z, radius) => {
      object.position.set(x, y, z);
      object.scale.setScalar(radius);
    },
    setVisible: (visible) => {
      object.visible = visible;
    },
    update: (seed, galaxy, camWorldX, camWorldY) => {
      if (disposed)
        return;
      // The band is the same for every galaxy; just hide it in the void.
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
    },
  };
}
