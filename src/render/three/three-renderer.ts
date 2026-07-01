/**
 * Stage 0 of the rendering-backend migration (docs/plans/rendering-backend.md):
 * a Three.js renderer that stands up the WebGPU pipeline (WebGL2 auto-fallback)
 * behind the engine `Renderer` seam and reproduces the current system-tier view
 * as a flat, top-down plane so nothing visibly regresses.
 *
 * It owns its own canvas (a canvas holds only one context type, so this cannot
 * share the 2D canvas) and draws the streamed bodies as flat discs on the z=0
 * plane. An orthographic camera, configured to match the Canvas 2D `worldToView`
 * mapping exactly (y increases downward), keeps every body at the same screen
 * position and size as the 2D path. The DOM/Preact HUD and the other LOD tiers
 * stay on Canvas 2D for now; later stages move more into the scene.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Renderer } from '@pierre/ecs/renderer';

import type { SectorCache } from '../../lod/sector-cache';
import type { SectorRange } from '../../lod/tier';
import type { GlowField } from './glow-fields';

import { worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { AdditiveBlending, CanvasTexture, CircleGeometry, Color, ColorManagement, DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PlaneGeometry, Scene, WebGPURenderer } from 'three/webgpu';

import { forEachGalaxyFieldGlow, forEachGalaxyGlow, forEachUniverseGlow } from './glow-fields';

/** Scene clear colour; matches the Canvas 2D background so the toggle is seamless. */
const BACKGROUND = 0x05060D;
/** Triangle count for the unit disc; bodies are small on screen, so this is ample. */
const CIRCLE_SEGMENTS = 24;
/**
 * Camera distance from the z=0 plane. Orthographic size is independent of depth,
 * so any value whose `[near, far]` brackets the plane works; this only sets the
 * clip range.
 */
const CAMERA_DEPTH = 1000;
const DEFAULT_FILL = '#ffffff';
/** Minimum on-screen star dot radius (px); mirrors the Canvas 2D star tier. */
const STAR_MIN_DOT_PX = 1.1;
/** Low-poly disc for star dots — they are only a few pixels across. */
const STAR_SEGMENTS = 8;
/** Initial star instance capacity; grown (reallocated) on demand, never shrunk. */
const STAR_INITIAL_CAPACITY = 8192;
/** Off-screen cull padding (px) for star instances, matching `drawStars`. */
const STAR_CULL_PAD_PX = 4;
/** Initial glow-sprite instance capacity; grown on demand, never shrunk. */
const GLOW_INITIAL_CAPACITY = 1024;
/** Radial glow-sprite texture resolution (px). */
const GLOW_TEXTURE_SIZE = 128;

/** Smallest power of two ≥ `n` (≥ 1), for instance-buffer growth. */
function nextPowerOfTwo(n: number): number {
  return n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n));
}

/** A white radial glow sprite (alpha falls off to the edge), tinted per instance. */
function makeGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIZE;
  canvas.height = GLOW_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const half = GLOW_TEXTURE_SIZE / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GLOW_TEXTURE_SIZE, GLOW_TEXTURE_SIZE);
  return new CanvasTexture(canvas);
}

/** Per-frame inputs: the render-origin-frame camera and the ECS world. */
export interface ThreeRenderContext {
  camera: Camera;
  world: EcsWorld;
}

/** Per-frame inputs for the aggregate glow tiers (galaxy / galaxy-field / universe). */
export interface ThreeGlowContext {
  camera: Camera;
  originX: number;
  originY: number;
  seed: number;
}

/** Per-frame inputs for the star tier: the visible sectors and the read origin. */
export interface ThreeStarContext {
  cache: SectorCache;
  camera: Camera;
  originX: number;
  originY: number;
  range: SectorRange;
}

export class ThreeRenderer implements Renderer<ThreeRenderContext> {
  /** The active backend once ready ('WebGPU' or 'WebGL2'), else null. */
  backendLabel: 'WebGL2' | 'WebGPU' | null = null;
  private readonly camera: OrthographicCamera;
  /** The WebGPU/WebGL canvas, positioned behind the 2D HUD canvas by the caller. */
  readonly canvas: HTMLCanvasElement;
  private readonly dummy = new Object3D();
  private readonly geometry: CircleGeometry;
  private glowCapacity = 0;
  private readonly glowGeometry: PlaneGeometry;
  private readonly glowMaterial: MeshBasicMaterial;
  private glowMesh: InstancedMesh | null = null;
  private readonly glowTexture: CanvasTexture;
  private readonly group: Group;
  private readonly pool: Mesh[] = [];
  /** True once `init()` has resolved; `render` is a no-op before then. */
  ready = false;
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private starCapacity = 0;
  private readonly starGeometry: CircleGeometry;
  private readonly starMaterial: MeshBasicMaterial;
  private starMesh: InstancedMesh | null = null;
  private readonly tmpColor = new Color();

  constructor() {
    // Match Canvas 2D's raw-sRGB colours: skip three's linear working-space
    // conversions so tints and additive blends read the same across backends.
    ColorManagement.enabled = false;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute; inset:0; display:none; width:100%; height:100%; pointer-events:none;';
    this.renderer = new WebGPURenderer({ antialias: true, canvas: this.canvas });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(BACKGROUND, 1);
    this.scene = new Scene();
    this.group = new Group();
    this.scene.add(this.group);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DEPTH * 2);
    this.geometry = new CircleGeometry(1, CIRCLE_SEGMENTS);
    this.starGeometry = new CircleGeometry(1, STAR_SEGMENTS);
    this.starMaterial = new MeshBasicMaterial({ side: DoubleSide });
    this.glowTexture = makeGlowTexture();
    this.glowGeometry = new PlaneGeometry(1, 1);
    this.glowMaterial = new MeshBasicMaterial({ blending: AdditiveBlending, depthTest: false, depthWrite: false, map: this.glowTexture, side: DoubleSide, transparent: true });
    this.renderer.init().then(() => {
      this.ready = true;
      // Record + report the active backend so the WebGPU / WebGL2-fallback path
      // is verifiable in the console and shown in the HUD renderer indicator.
      this.backendLabel = this.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
      console.warn(`ProcUniverse: Three.js renderer ready (${this.backendLabel}).`);
    }).catch((error: unknown) => {
      console.error('ProcUniverse: Three.js renderer failed to initialise.', error);
    });
  }

  dispose(): void {
    for (const mesh of this.pool)
      (mesh.material as MeshBasicMaterial).dispose();
    this.starMesh?.dispose();
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.glowMesh?.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
    this.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** Ensure the glow instanced mesh holds ≥ `count` instances, growing as needed. */
  private ensureGlowMesh(count: number): InstancedMesh {
    if (this.glowMesh && this.glowCapacity >= count)
      return this.glowMesh;
    if (this.glowMesh) {
      this.scene.remove(this.glowMesh);
      this.glowMesh.dispose();
    }
    const capacity = Math.max(GLOW_INITIAL_CAPACITY, nextPowerOfTwo(count));
    const mesh = new InstancedMesh(this.glowGeometry, this.glowMaterial, capacity);
    mesh.frustumCulled = false;
    this.glowMesh = mesh;
    this.glowCapacity = capacity;
    this.scene.add(mesh);
    return mesh;
  }

  /** Ensure the star instanced mesh holds ≥ `count` instances, growing as needed. */
  private ensureStarMesh(count: number): InstancedMesh {
    if (this.starMesh && this.starCapacity >= count)
      return this.starMesh;
    if (this.starMesh) {
      this.scene.remove(this.starMesh);
      this.starMesh.dispose();
    }
    const capacity = Math.max(STAR_INITIAL_CAPACITY, nextPowerOfTwo(count));
    const mesh = new InstancedMesh(this.starGeometry, this.starMaterial, capacity);
    mesh.frustumCulled = false;
    this.starMesh = mesh;
    this.starCapacity = capacity;
    this.scene.add(mesh);
    return mesh;
  }

  /** Reuse a pooled disc mesh, creating one on first use. */
  private obtainMesh(index: number): Mesh {
    let mesh = this.pool[index];
    if (!mesh) {
      // The camera inverts the y axis (swapped top/bottom) to match Canvas 2D's
      // y-down convention, which reverses triangle winding; DoubleSide stops the
      // discs from being back-face culled and rendering invisible.
      mesh = new Mesh(this.geometry, new MeshBasicMaterial({ side: DoubleSide }));
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  /**
   * Draw the streamed bodies as flat discs. `camera` is already in the floating
   * render-origin frame, so coordinates stay small and precise. Bodies are
   * matched to a reused mesh pool; the surplus is hidden rather than freed.
   */
  render(ctx: ThreeRenderContext): void {
    if (!this.ready)
      return;
    const { camera, world } = ctx;
    this.syncCamera(camera);
    this.group.visible = true;
    if (this.starMesh)
      this.starMesh.visible = false;
    if (this.glowMesh)
      this.glowMesh.visible = false;

    const renderables = world.getStore(RenderableDef);
    const positions = world.getStore(PositionDef);
    let used = 0;
    for (const [id] of world.query(RenderableDef)) {
      const renderable = renderables.get(id);
      if (!renderable || renderable.kind !== 'circle')
        continue;
      const position = positions.get(id);
      if (!position)
        continue;
      const mesh = this.obtainMesh(used++);
      mesh.position.set(position.x, position.y, 0);
      mesh.scale.set(renderable.radius, renderable.radius, 1);
      (mesh.material as MeshBasicMaterial).color.set(renderable.fill ?? DEFAULT_FILL);
    }
    for (let i = used; i < this.pool.length; i++) {
      const mesh = this.pool[i];
      if (mesh)
        mesh.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** GALAXY tier: aggregate galaxy-density glow (one draw call). Mirrors `drawGalaxy`. */
  renderGalaxy(ctx: ThreeGlowContext): number {
    return this.renderGlowTier(ctx, forEachGalaxyGlow);
  }

  /**
   * GALAXY-FIELD tier: draw each galaxy as an additive glow sprite in one draw
   * call. Mirrors the sprite pass of `drawGalaxyField` (the NGC labels stay on
   * the 2D overlay). Returns the number of sprites drawn.
   */
  renderGalaxyField(ctx: ThreeGlowContext): number {
    return this.renderGlowTier(ctx, forEachGalaxyFieldGlow);
  }

  /** Fill and draw the shared additive glow mesh from a tier's glow iterator. */
  private renderGlowTier(ctx: ThreeGlowContext, forEach: GlowField): number {
    if (!this.ready)
      return 0;
    const { camera, originX, originY, seed } = ctx;
    this.syncCamera(camera);
    this.group.visible = false;
    if (this.starMesh)
      this.starMesh.visible = false;

    let capacity = 0;
    forEach(camera, seed, originX, originY, () => {
      capacity++;
    });
    const mesh = this.ensureGlowMesh(capacity);

    let i = 0;
    forEach(camera, seed, originX, originY, (x, y, radius, r, g, b, alpha) => {
      this.dummy.position.set(x, y, 0);
      this.dummy.scale.set(radius * 2, radius * 2, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.tmpColor.setRGB((r / 255) * alpha, (g / 255) * alpha, (b / 255) * alpha);
      mesh.setColorAt(i, this.tmpColor);
      i++;
    });
    mesh.count = i;
    mesh.visible = i > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor)
      mesh.instanceColor.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return i;
  }

  /**
   * STAR tier: draw each visible system as an instanced disc — one draw call for
   * the whole field. Mirrors `drawStars` (same positions, per-star colour, and
   * min-floored size). Returns the number of stars drawn.
   */
  renderStars(ctx: ThreeStarContext): number {
    if (!this.ready)
      return 0;
    const { cache, camera, originX, originY, range } = ctx;
    this.syncCamera(camera);
    this.group.visible = false;
    if (this.glowMesh)
      this.glowMesh.visible = false;

    let capacity = 0;
    for (let sy = range.minSy; sy <= range.maxSy; sy++) {
      for (let sx = range.minSx; sx <= range.maxSx; sx++)
        capacity += cache.get(sx, sy).systems.length;
    }
    const mesh = this.ensureStarMesh(capacity);

    const minRadius = STAR_MIN_DOT_PX / camera.zoom;
    const maxX = camera.viewportW + STAR_CULL_PAD_PX;
    const maxY = camera.viewportH + STAR_CULL_PAD_PX;
    let i = 0;
    for (let sy = range.minSy; sy <= range.maxSy; sy++) {
      for (let sx = range.minSx; sx <= range.maxSx; sx++) {
        for (const sys of cache.get(sx, sy).systems) {
          const v = worldToView(sys.x - originX, sys.y - originY, camera);
          if (v.vx < -STAR_CULL_PAD_PX || v.vx > maxX || v.vy < -STAR_CULL_PAD_PX || v.vy > maxY)
            continue;
          const r = Math.max(minRadius, sys.radius);
          this.dummy.position.set(sys.x - originX, sys.y - originY, 0);
          this.dummy.scale.set(r, r, 1);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(i, this.tmpColor.set(sys.star.colorHex));
          i++;
        }
      }
    }
    mesh.count = i;
    mesh.visible = i > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor)
      mesh.instanceColor.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return i;
  }

  /** UNIVERSE tier: aggregate cosmic-web glow (one draw call). Mirrors `drawUniverse`. */
  renderUniverse(ctx: ThreeGlowContext): number {
    return this.renderGlowTier(ctx, forEachUniverseGlow);
  }

  /** Match the backing store to the 2D canvas so both share one coordinate space. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  /**
   * Configure the orthographic camera to reproduce the Canvas 2D `worldToView`
   * mapping. The view spans `viewport / zoom` world units centred on the camera;
   * inverting `top`/`bottom` flips the y axis so world +y renders downward, as in
   * Canvas 2D. Looking straight down -Z needs no rotation, only a position.
   */
  private syncCamera(camera: Camera): void {
    const centerX = camera.x + camera.offsetX;
    const centerY = camera.y + camera.offsetY;
    const halfW = camera.viewportW / camera.zoom / 2;
    const halfH = camera.viewportH / camera.zoom / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = -halfH;
    this.camera.bottom = halfH;
    this.camera.position.set(centerX, centerY, CAMERA_DEPTH);
    this.camera.updateProjectionMatrix();
  }
}
