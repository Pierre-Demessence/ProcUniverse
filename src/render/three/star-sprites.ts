/**
 * Star-tier sprite layer: every system in range drawn as one camera-facing,
 * additive, HDR sprite (a bright core over a soft halo) in a single instanced
 * draw, bloomed by the shared post-process like the system tier's star glare.
 * Brightness and size follow apparent brightness (`star-brightness.ts`); the
 * brightest few also get diffraction spikes. The layer remembers what it drew
 * so the renderer can pick, hover-label and zoom onto a star.
 */

import type { Group, Quaternion, Vector3 } from 'three/webgpu';

import type { SectorData, SystemData } from '../../generation/universe';
import type { SectorCache } from '../../lod/sector-cache';
import type { SectorRange } from '../../lod/tier';

import { abs, exp, float, length, pow, smoothstep, uv, vec2, vec4 } from 'three/tsl';
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicNodeMaterial, Object3D, PlaneGeometry } from 'three/webgpu';

import { STAR_LABEL_COUNT, STAR_SECTOR_BUDGET_MS, STAR_SPIKE_COUNT } from '../../config/render';
import { SECTOR_SIZE } from '../../scale';
import { apparentStarLevel, boostSaturation, starSpriteIntensity, starSpriteSizePx } from '../star-brightness';

/** Initial sprite instance capacity; grown (reallocated) on demand, never shrunk. */
const INITIAL_CAPACITY = 8192;
/** Spike sprite diameter as a multiple of the star sprite's. */
const SPIKE_SIZE_FACTOR = 3.5;
/** Spike brightness relative to the star's sprite. */
const SPIKE_GAIN = 0.6;
/** Only stars at least this bright (apparent level) grow spikes. */
const SPIKE_MIN_LEVEL = 0.55;
/** Outer fraction of the drawn radius over which the field fades out, hiding its edge. */
const EDGE_FADE_START = 0.75;
const WHITE = new Color(1, 1, 1);
/** Parsed star colours kept before the cache resets (distinct blackbody hexes). */
const COLOR_CACHE_CAP = 4096;

/** Smallest power of two ≥ `n` (≥ 1), for instance-buffer growth. */
function nextPowerOfTwo(n: number): number {
  return n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n));
}

/** Radial core + halo: a tight bright core, a soft wide glow, zero at the quad edge. */
function createCoreMaterial(): MeshBasicNodeMaterial {
  const d = length(uv().sub(0.5)).mul(2);
  const core = exp(d.div(0.16).pow(2).negate());
  const halo = exp(d.mul(-5)).mul(0.3);
  const profile = core.add(halo).mul(float(1).sub(smoothstep(0.8, 1, d)));
  return spriteMaterial(profile);
}

/** A thin screen-aligned cross, tapering along its arms. */
function createSpikeMaterial(): MeshBasicNodeMaterial {
  const p = uv().sub(0.5).mul(2);
  const ax = abs(p.x);
  const ay = abs(p.y);
  const horizontal = exp(ay.mul(-80)).mul(pow(float(1).sub(ax).max(0), 3));
  const vertical = exp(ax.mul(-80)).mul(pow(float(1).sub(ay).max(0), 3));
  const profile = horizontal.add(vertical).mul(float(1).sub(smoothstep(0.85, 1, length(vec2(p.x, p.y)))));
  return spriteMaterial(profile);
}

/** Additive, depth-tested (never depth-writing) sprite; the instance colour tints and scales it. */
function spriteMaterial(profile: ReturnType<typeof exp>): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ blending: AdditiveBlending, depthWrite: false, side: DoubleSide, transparent: true });
  material.colorNode = vec4(profile, profile, profile, 1);
  return material;
}

/** Per-frame inputs; positions are render-origin-local AU unless noted. */
export interface StarLayerFrame {
  cache: Pick<SectorCache, 'get' | 'peek'>;
  /** Camera world position and orientation (the sprites face the camera plane). */
  cameraPosition: Vector3;
  cameraQuaternion: Quaternion;
  /** The focused system, whose sprite hands over from its sphere, or null. */
  focused: SystemData | null;
  focusedWeight: number;
  focusX: number;
  focusY: number;
  focusZ: number;
  /** Stars farther than this (in x, y) from the focus are dropped, fading out before it. */
  horizontalReach: number;
  originX: number;
  originY: number;
  originZ: number;
  /** Screen pixels per world unit at unit distance. */
  pxFactor: number;
  range: SectorRange;
  /** Weight of every non-focused star (the star layer's fade-in). */
  weight: number;
}

/** A drawn star, for labels / hover. */
export interface DrawnStar {
  system: SystemData;
  x: number;
  y: number;
  z: number;
}

export class StarSpriteLayer {
  private capacity = 0;
  private readonly colors = new Map<string, Color>();
  private readonly coreMaterial = createCoreMaterial();
  private count = 0;
  private readonly dummy = new Object3D();
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly group: Group;
  private mesh: InstancedMesh | null = null;
  /** Sector coordinates (sx, sy pairs) not yet generated this frame. */
  private readonly missing: number[] = [];
  /** Local positions (x, y, z) of the drawn stars, in draw order. */
  private positions = new Float64Array(INITIAL_CAPACITY * 3);
  private readonly rgb: [number, number, number] = [0, 0, 0];
  private readonly sectors: SectorData[] = [];
  private readonly spikeMaterial = createSpikeMaterial();
  private readonly spikes: InstancedMesh;
  /** Systems of the drawn stars, parallel to `positions`. */
  private systems: SystemData[] = [];
  private readonly tmpColor = new Color();
  /** Indices of the brightest drawn stars, brightest first, with their levels. */
  private readonly top: number[] = [];
  private readonly topCount = Math.max(STAR_LABEL_COUNT, STAR_SPIKE_COUNT);
  private readonly topLevel: number[] = [];
  private readonly topSize: number[] = [];

  constructor(group: Group) {
    this.group = group;
    this.spikes = new InstancedMesh(this.geometry, this.spikeMaterial, Math.max(1, STAR_SPIKE_COUNT));
    this.spikes.frustumCulled = false;
    // Create the colour attribute up front so the material compiles with it.
    this.spikes.setColorAt(0, WHITE);
    this.spikes.count = 0;
    this.spikes.visible = false;
    group.add(this.spikes);
  }

  /** The brightest drawn stars (up to `STAR_LABEL_COUNT`), brightest first. */
  brightest(out: DrawnStar[]): DrawnStar[] {
    out.length = 0;
    for (let k = 0; k < Math.min(STAR_LABEL_COUNT, this.top.length); k++)
      out.push(this.drawn(this.top[k]));
    return out;
  }

  dispose(): void {
    this.mesh?.dispose();
    this.spikes.dispose();
    this.geometry.dispose();
    this.coreMaterial.dispose();
    this.spikeMaterial.dispose();
  }

  private drawn(i: number): DrawnStar {
    return { system: this.systems[i], x: this.positions[i * 3], y: this.positions[i * 3 + 1], z: this.positions[i * 3 + 2] };
  }

  private ensureMesh(count: number): InstancedMesh {
    if (this.mesh && this.capacity >= count)
      return this.mesh;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const capacity = Math.max(INITIAL_CAPACITY, nextPowerOfTwo(count));
    const mesh = new InstancedMesh(this.geometry, this.coreMaterial, capacity);
    mesh.frustumCulled = false;
    // Create the colour attribute up front so the material compiles with it.
    mesh.setColorAt(0, WHITE);
    this.mesh = mesh;
    this.capacity = capacity;
    if (this.positions.length < capacity * 3)
      this.positions = new Float64Array(capacity * 3);
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Fill the sprites for this frame from the sectors in `range`. The mesh sits
   * at the focus and instances are stored relative to it, so float32 instance
   * data stays precise. Returns the number of stars drawn.
   */
  fill(f: StarLayerFrame): number {
    this.generateMissing(f);
    const sectors = this.sectors;
    sectors.length = 0;
    let capacity = 0;
    for (let sy = f.range.minSy; sy <= f.range.maxSy; sy++) {
      for (let sx = f.range.minSx; sx <= f.range.maxSx; sx++) {
        const sector = f.cache.peek(sx, sy);
        if (!sector)
          continue;
        sectors.push(sector);
        capacity += sector.systems.length;
      }
    }
    const mesh = this.ensureMesh(capacity);
    mesh.position.set(f.focusX, f.focusY, f.focusZ);
    this.top.length = 0;
    this.topLevel.length = 0;
    this.topSize.length = 0;
    this.systems.length = 0;
    const cam = f.cameraPosition;
    const fadeStart = f.horizontalReach * EDGE_FADE_START;
    let i = 0;
    for (const sector of sectors) {
      for (const sys of sector.systems) {
        const isFocused = f.focused !== null && sys.name.scientific === f.focused.name.scientific;
        let weight = isFocused ? f.focusedWeight : f.weight;
        const x = sys.x - f.originX;
        const y = sys.y - f.originY;
        const z = sys.z - f.originZ;
        const horizontal = Math.hypot(x - f.focusX, y - f.focusY);
        if (horizontal > f.horizontalReach)
          continue;
        if (horizontal > fadeStart)
          weight *= 1 - (horizontal - fadeStart) / (f.horizontalReach - fadeStart);
        if (weight <= 0)
          continue;
        const distance = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
        const level = apparentStarLevel(sys.star.luminosity, distance);
        const sizePx = starSpriteSizePx(level);
        const size = f.pxFactor > 0 ? (sizePx * distance) / f.pxFactor : 0;
        this.dummy.position.set(x - f.focusX, y - f.focusY, z - f.focusZ);
        this.dummy.quaternion.copy(f.cameraQuaternion);
        this.dummy.scale.set(size, size, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        const base = this.starColor(sys.star.colorHex);
        const gain = starSpriteIntensity(level) * weight;
        mesh.setColorAt(i, this.tmpColor.setRGB(base.r * gain, base.g * gain, base.b * gain));
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.systems.push(sys);
        this.rankTop(i, level * weight, size);
        i++;
      }
    }
    sectors.length = 0;
    this.count = i;
    mesh.count = i;
    mesh.visible = i > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor)
      mesh.instanceColor.needsUpdate = true;
    this.fillSpikes(f, mesh);
    return i;
  }

  /** Diffraction spikes on the brightest few stars, reusing their instance transforms. */
  private fillSpikes(f: StarLayerFrame, mesh: InstancedMesh): void {
    const spikes = this.spikes;
    spikes.position.copy(mesh.position);
    let n = 0;
    for (let k = 0; k < Math.min(STAR_SPIKE_COUNT, this.top.length); k++) {
      if (this.topLevel[k] < SPIKE_MIN_LEVEL)
        break;
      const i = this.top[k];
      const size = this.topSize[k] * SPIKE_SIZE_FACTOR;
      this.dummy.position.set(this.positions[i * 3] - f.focusX, this.positions[i * 3 + 1] - f.focusY, this.positions[i * 3 + 2] - f.focusZ);
      this.dummy.quaternion.copy(f.cameraQuaternion);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      spikes.setMatrixAt(n, this.dummy.matrix);
      mesh.getColorAt(i, this.tmpColor);
      spikes.setColorAt(n, this.tmpColor.multiplyScalar(SPIKE_GAIN));
      n++;
    }
    spikes.count = n;
    spikes.visible = n > 0;
    spikes.instanceMatrix.needsUpdate = true;
    if (spikes.instanceColor)
      spikes.instanceColor.needsUpdate = true;
  }

  /**
   * Generate the range's uncached sectors nearest the focus first, within
   * `STAR_SECTOR_BUDGET_MS` (always at least one), so a wide or tilted view
   * fills in over a few frames instead of hitching.
   */
  private generateMissing(f: StarLayerFrame): void {
    const missing = this.missing;
    missing.length = 0;
    for (let sy = f.range.minSy; sy <= f.range.maxSy; sy++) {
      for (let sx = f.range.minSx; sx <= f.range.maxSx; sx++) {
        if (!f.cache.peek(sx, sy))
          missing.push(sx, sy);
      }
    }
    if (missing.length === 0)
      return;
    const fx = Math.floor((f.focusX + f.originX) / SECTOR_SIZE);
    const fy = Math.floor((f.focusY + f.originY) / SECTOR_SIZE);
    const order = Array.from({ length: missing.length / 2 }, (_, k) => k);
    order.sort((a, b) => Math.hypot(missing[a * 2] - fx, missing[a * 2 + 1] - fy) - Math.hypot(missing[b * 2] - fx, missing[b * 2 + 1] - fy));
    const deadline = performance.now() + STAR_SECTOR_BUDGET_MS;
    for (const k of order) {
      f.cache.get(missing[k * 2], missing[k * 2 + 1]);
      if (performance.now() >= deadline)
        break;
    }
  }

  hide(): void {
    if (this.mesh)
      this.mesh.visible = false;
    this.spikes.visible = false;
    this.count = 0;
    this.systems.length = 0;
    this.top.length = 0;
  }

  /**
   * The drawn star nearest `(bx, by)` within `radiusPx` on screen, or null.
   * `project` maps a render-origin-frame point to screen px (false if hidden).
   */
  nearestOnScreen(bx: number, by: number, radiusPx: number, project: (x: number, y: number, z: number, out: { sx: number; sy: number }) => boolean): DrawnStar | null {
    const screen = { sx: 0, sy: 0 };
    let best = -1;
    let bestD2 = radiusPx * radiusPx;
    for (let i = 0; i < this.count; i++) {
      if (!project(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2], screen))
        continue;
      const dx = screen.sx - bx;
      const dy = screen.sy - by;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best < 0 ? null : this.drawn(best);
  }

  /** Keep `top` as the brightest `topCount` stars seen so far, brightest first. */
  private rankTop(i: number, level: number, size: number): void {
    const top = this.top;
    const levels = this.topLevel;
    if (top.length === this.topCount && level <= levels[top.length - 1])
      return;
    let k = Math.min(top.length, this.topCount - 1);
    top[k] = i;
    levels[k] = level;
    this.topSize[k] = size;
    while (k > 0 && levels[k - 1] < level) {
      top[k] = top[k - 1];
      levels[k] = levels[k - 1];
      this.topSize[k] = this.topSize[k - 1];
      k--;
      top[k] = i;
      levels[k] = level;
      this.topSize[k] = size;
    }
  }

  /** The (saturation-boosted) colour for a star's hex, cached across frames. */
  private starColor(hex: string): Color {
    let color = this.colors.get(hex);
    if (!color) {
      if (this.colors.size >= COLOR_CACHE_CAP)
        this.colors.clear();
      const parsed = new Color(hex);
      const [r, g, b] = boostSaturation(parsed.r, parsed.g, parsed.b, this.rgb);
      color = new Color(r, g, b);
      this.colors.set(hex, color);
    }
    return color;
  }
}
