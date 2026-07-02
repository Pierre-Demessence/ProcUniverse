/**
 * Three.js renderer (WebGPU pipeline, WebGL2 auto-fallback) behind the engine
 * `Renderer` seam — the parallel rendering backend from
 * docs/plans/rendering-backend.md, selectable via the runtime toggle.
 *
 * It owns its own canvas (a canvas holds only one context type, so this cannot
 * share the 2D canvas). The system tier draws bodies as lit, rotating 3D spheres
 * viewed by an orbit/tilt perspective camera (orbits stay coplanar at z=0); the
 * star + galaxy / galaxy-field / universe tiers draw instanced points / additive
 * glow sprites under an orthographic top-down camera matching the Canvas 2D
 * mapping. The DOM/Preact HUD stays on Canvas 2D.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { Camera } from '@pierre/ecs/modules/camera';
import type { Renderer } from '@pierre/ecs/renderer';

import type { SectorCache } from '../../lod/sector-cache';
import type { SectorRange } from '../../lod/tier';
import type { BodyKind, PickResult } from '../../pick';
import type { GlowField } from './glow-fields';

import { worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ColorManagement, DirectionalLight, DoubleSide, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';

import { CAMERA_FOV_DEG, LIGHT_AMBIENT, LIGHT_KEY, RENDER_ANTIALIAS, RENDER_SCALE, SPHERE_HEIGHT_SEGMENTS, SPHERE_WIDTH_SEGMENTS, STAR_SPIN_RATE } from '../../config/render';
import { BlackHoleDef } from '../../generation/galaxies';
import { MoonPhysicalDef } from '../../generation/moons';
import { PlanetPhysicalDef } from '../../generation/planets';
import { StarPhysicalDef } from '../../generation/stars';
import { OrbitElementsDef } from '../../sim/orbits';
import { forEachGalaxyFieldGlow, forEachGalaxyGlow, forEachUniverseGlow } from './glow-fields';

/** Scene clear colour; matches the Canvas 2D background so the toggle is seamless. */
const BACKGROUND = 0x05060D;
/**
 * Camera distance from the z=0 plane for the orthographic (non-system) tiers.
 * Orthographic size is independent of depth, so any value whose `[near, far]`
 * brackets the plane works; this only sets the clip range.
 */
const CAMERA_DEPTH = 1000;
const DEFAULT_FILL = '#ffffff';
const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;
/** Dark grey for the black-hole sphere so it reads as a shaded body, not black-on-black. */
const BLACK_HOLE_COLOR = '#15151c';
/** Orbit-ring line resolution + faint styling; mirrors the 2D `drawOrbitRings`. */
const RING_SEGMENTS = 128;
const RING_MIN_PX = 3;
const RING_COLOR = 0x96B4E6;
const RING_OPACITY = 0.14;
/** Initial orbit capacity for the merged ring buffer; grown on demand. */
const RING_INITIAL_ORBITS = 64;
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

/** Per-frame inputs for the 3D system tier: camera, orbit angles, sim clock, world. */
export interface ThreeRenderContext {
  azimuth: number;
  camera: Camera;
  simSeconds: number;
  tilt: number;
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
  private glowCapacity = 0;
  private readonly glowGeometry: PlaneGeometry;
  private readonly glowMaterial: MeshBasicMaterial;
  private glowMesh: InstancedMesh | null = null;
  private readonly glowTexture: CanvasTexture;
  private readonly group: Group;
  private readonly perspective: PerspectiveCamera;
  private readonly pool: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  /** True once `init()` has resolved; `render` is a no-op before then. */
  ready = false;
  private readonly renderer: WebGPURenderer;
  private ringCapacity = 0;
  private readonly ringMaterial: LineBasicMaterial;
  private ringMesh: LineSegments | null = null;
  private readonly scene: Scene;
  private readonly sphereGeometry: SphereGeometry;
  private starCapacity = 0;
  private readonly starGeometry: CircleGeometry;
  private readonly starMaterial: MeshBasicMaterial;
  private starMesh: InstancedMesh | null = null;
  private readonly tmpColor = new Color();
  private readonly tmpVec = new Vector3();
  private readonly tmpVec2 = new Vector2();
  private viewH = 0;
  private viewW = 0;

  constructor() {
    // Match Canvas 2D's raw-sRGB colours: skip three's linear working-space
    // conversions so tints and additive blends read the same across backends.
    ColorManagement.enabled = false;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute; inset:0; display:none; width:100%; height:100%; pointer-events:none;';
    this.renderer = new WebGPURenderer({ antialias: RENDER_ANTIALIAS, canvas: this.canvas });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(BACKGROUND, 1);
    this.scene = new Scene();
    this.group = new Group();
    this.scene.add(this.group);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DEPTH * 2);
    this.perspective = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, CAMERA_DEPTH);
    this.sphereGeometry = new SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
    this.starGeometry = new CircleGeometry(1, STAR_SEGMENTS);
    this.starMaterial = new MeshBasicMaterial({ side: DoubleSide });
    this.glowTexture = makeGlowTexture();
    this.glowGeometry = new PlaneGeometry(1, 1);
    this.glowMaterial = new MeshBasicMaterial({ blending: AdditiveBlending, depthTest: false, depthWrite: false, map: this.glowTexture, side: DoubleSide, transparent: true });
    // Lights shade the (non-emissive) planet / moon spheres; emissive stars and
    // the unlit instanced tiers ignore them.
    this.scene.add(new AmbientLight(0xFFFFFF, LIGHT_AMBIENT));
    const keyLight = new DirectionalLight(0xFFFFFF, LIGHT_KEY);
    keyLight.position.set(1, 1, 2);
    this.scene.add(keyLight);
    this.ringMaterial = new LineBasicMaterial({ color: RING_COLOR, opacity: RING_OPACITY, transparent: true });
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
      (mesh.material as MeshStandardMaterial).dispose();
    this.starMesh?.dispose();
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.glowMesh?.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
    this.sphereGeometry.dispose();
    this.ringMesh?.geometry.dispose();
    this.ringMaterial.dispose();
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

  /** Ensure the merged ring buffer holds ≥ `orbitCount` orbits, growing on demand. */
  private ensureRingMesh(orbitCount: number): LineSegments {
    if (this.ringMesh && this.ringCapacity >= orbitCount)
      return this.ringMesh;
    if (this.ringMesh) {
      this.scene.remove(this.ringMesh);
      this.ringMesh.geometry.dispose();
    }
    const capacity = Math.max(RING_INITIAL_ORBITS, nextPowerOfTwo(orbitCount));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * RING_SEGMENTS * 2 * 3), 3));
    const mesh = new LineSegments(geometry, this.ringMaterial);
    mesh.frustumCulled = false;
    this.ringMesh = mesh;
    this.ringCapacity = capacity;
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

  /**
   * World-unit reach of the system nearest the camera focus: the distance to its
   * star plus the widest planet apoapsis in the scene. Keeps the perspective far
   * plane tight enough to clip other systems (light-years away) while still
   * enclosing the focused system, including its central star when zoomed in on an
   * outer planet.
   */
  private focusedSystemReach(world: EcsWorld, focusX: number, focusY: number): number {
    const positions = world.getStore(PositionDef);
    let nearestStar2 = Infinity;
    for (const [id] of world.query(StarPhysicalDef)) {
      const p = positions.get(id);
      if (!p)
        continue;
      const dx = p.x - focusX;
      const dy = p.y - focusY;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestStar2)
        nearestStar2 = d2;
    }
    if (!Number.isFinite(nearestStar2))
      return 0;
    let maxApoapsis = 0;
    for (const [, orbit] of world.query(OrbitElementsDef)) {
      const apoapsis = orbit.a * (1 + orbit.e);
      if (apoapsis > maxApoapsis)
        maxApoapsis = apoapsis;
    }
    return Math.sqrt(nearestStar2) + maxApoapsis;
  }

  /** Reuse a pooled sphere mesh, creating one (with its own lit material) on first use. */
  private obtainSphere(index: number): Mesh {
    let mesh = this.pool[index];
    if (!mesh) {
      mesh = new Mesh(this.sphereGeometry, new MeshStandardMaterial({ metalness: 0, roughness: 0.95 }));
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  /**
   * Raycast the cursor (backing px) against the visible system-tier spheres and
   * return the body it hits, or null. Used for picking in the 3D system view.
   */
  pickAt(bx: number, by: number): PickResult | null {
    if (!this.ready)
      return null;
    this.tmpVec2.set((bx / this.viewW) * 2 - 1, -((by / this.viewH) * 2 - 1));
    this.raycaster.setFromCamera(this.tmpVec2, this.perspective);
    const targets = this.group.children.filter(child => child.visible);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit)
      return null;
    const data = hit.object.userData as { id?: number; kind?: BodyKind };
    return data.id === undefined || data.kind === undefined ? null : { id: data.id, kind: data.kind };
  }

  /**
   * Project a render-origin-frame world point through the perspective camera to
   * backing-pixel screen coordinates (shared with the 2D overlay). Returns false
   * when the point is behind/beyond the camera. Used to place 3D body labels.
   */
  projectToScreen(x: number, y: number, z: number, out: { sx: number; sy: number }): boolean {
    this.tmpVec.set(x, y, z).project(this.perspective);
    out.sx = (this.tmpVec.x * 0.5 + 0.5) * this.viewW;
    out.sy = (this.tmpVec.y * -0.5 + 0.5) * this.viewH;
    return this.tmpVec.z < 1;
  }

  /**
   * SYSTEM tier: draw the streamed bodies as lit, rotating 3D spheres viewed by
   * a perspective camera the user can orbit / tilt. `camera` is in the floating
   * render-origin frame; orbits stay coplanar (z=0). Stars are emissive, planets
   * and moons are lit, the black hole is a dark shaded sphere. Bodies reuse a
   * pooled sphere mesh; the surplus is hidden.
   */
  render(ctx: ThreeRenderContext): void {
    if (!this.ready)
      return;
    const { azimuth, camera, simSeconds, tilt, world } = ctx;
    this.group.visible = true;
    if (this.starMesh)
      this.starMesh.visible = false;
    if (this.glowMesh)
      this.glowMesh.visible = false;

    const renderables = world.getStore(RenderableDef);
    const positions = world.getStore(PositionDef);
    const planets = world.getStore(PlanetPhysicalDef);
    const focusX = camera.x + camera.offsetX;
    const focusY = camera.y + camera.offsetY;
    // Frustum reach = the focused system only (nearest star + the widest planet
    // apoapsis), so the perspective far plane stays tight and neighbouring
    // systems — light-years away — are clipped rather than drawn (bodies and
    // labels) behind the current one.
    const sceneRadius = this.focusedSystemReach(world, focusX, focusY);
    let used = 0;

    const place = (id: number, kind: BodyKind, emissive: boolean, colorOverride: string | null, rotX: number, rotY: number): void => {
      const renderable = renderables.get(id);
      const position = positions.get(id);
      if (!renderable || renderable.kind !== 'circle' || !position)
        return;
      const fill = colorOverride ?? renderable.fill ?? DEFAULT_FILL;
      const mesh = this.obtainSphere(used++);
      mesh.position.set(position.x, position.y, 0);
      mesh.scale.setScalar(renderable.radius);
      mesh.rotation.set(rotX, rotY, 0);
      const material = mesh.material as MeshStandardMaterial;
      material.color.set(emissive ? '#000000' : fill);
      material.emissive.set(emissive ? fill : '#000000');
      const data = mesh.userData as { id: number; kind: BodyKind };
      data.id = id;
      data.kind = kind;
    };

    const starSpin = simSeconds * STAR_SPIN_RATE;
    for (const [id] of world.query(StarPhysicalDef))
      place(id, 'star', true, null, 0, starSpin);
    for (const [id] of world.query(PlanetPhysicalDef)) {
      const planet = planets.get(id);
      const rotX = planet ? planet.obliquity * DEG2RAD : 0;
      const rotY = planet ? (simSeconds / (planet.rotationPeriod * 3600)) * TAU : 0;
      place(id, 'planet', false, null, rotX, rotY);
    }
    for (const [id] of world.query(MoonPhysicalDef))
      place(id, 'moon', false, null, 0, 0);
    for (const [id] of world.query(BlackHoleDef))
      place(id, 'black-hole', false, BLACK_HOLE_COLOR, 0, 0);

    for (let i = used; i < this.pool.length; i++) {
      const mesh = this.pool[i];
      if (mesh)
        mesh.visible = false;
    }

    this.syncPerspective(camera, azimuth, tilt, sceneRadius);
    this.updateOrbitRings(world, camera.zoom);
    this.renderer.render(this.scene, this.perspective);
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
    if (this.ringMesh)
      this.ringMesh.visible = false;
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
    if (this.ringMesh)
      this.ringMesh.visible = false;
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
    this.viewW = width;
    this.viewH = height;
    // Render at a fraction of the device resolution and let CSS upscale: the 3D
    // system view is fill-rate bound when a body fills the screen, and pixel
    // count dominates. Picking/labels use the logical size, so they're unaffected.
    this.renderer.setSize(Math.max(1, Math.round(width * RENDER_SCALE)), Math.max(1, Math.round(height * RENDER_SCALE)), false);
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

  /**
   * Configure the perspective camera to orbit the focus (the render-origin-frame
   * camera x,y at z=0). Distance is derived from `zoom` so the framing roughly
   * matches the 2D view; `tilt` is the polar angle from straight-down and
   * `azimuth` swings around. Up is the system's polar (+z) axis.
   */
  private syncPerspective(camera: Camera, azimuth: number, tilt: number, sceneRadius: number): void {
    const fovRad = CAMERA_FOV_DEG * DEG2RAD;
    const halfHeightWorld = camera.viewportH / camera.zoom / 2;
    const distance = halfHeightWorld / Math.tan(fovRad / 2);
    const focusX = camera.x + camera.offsetX;
    const focusY = camera.y + camera.offsetY;
    const sinTilt = Math.sin(tilt);
    const p = this.perspective;
    p.fov = CAMERA_FOV_DEG;
    p.aspect = camera.viewportW / Math.max(1, camera.viewportH);
    p.near = Math.max(distance * 1e-3, 1e-9);
    // Extend the far plane to enclose the whole system: zoomed in on an outer
    // body the central star sits `sceneRadius` away and would otherwise fall
    // beyond a far plane tied only to the (small) focus distance.
    p.far = Math.max(distance * 4 + halfHeightWorld * 4, distance + sceneRadius * 1.5 + halfHeightWorld * 4);
    p.position.set(focusX + distance * sinTilt * Math.cos(azimuth), focusY + distance * sinTilt * Math.sin(azimuth), distance * Math.cos(tilt));
    p.up.set(0, 0, 1);
    p.lookAt(focusX, focusY, 0);
    p.updateProjectionMatrix();
  }

  /**
   * Rebuild every visible orbit ring into a single merged `LineSegments` — one
   * draw call and one buffer upload regardless of orbit count (individual line
   * objects were per-object overhead that scaled with zoom). Mirrors the 2D
   * `drawOrbitRings` ellipse (centre offset a·e away from periapsis, semi-minor
   * a·√(1−e²), rotated by argPeriapsis) in the z=0 plane; tiny orbits are culled.
   */
  private updateOrbitRings(world: EcsWorld, zoom: number): void {
    let count = 0;
    for (const [, orbit] of world.query(OrbitElementsDef)) {
      if (orbit.a * zoom >= RING_MIN_PX)
        count++;
    }
    if (count === 0) {
      if (this.ringMesh)
        this.ringMesh.visible = false;
      return;
    }

    const mesh = this.ensureRingMesh(count);
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    let v = 0;
    for (const [, orbit] of world.query(OrbitElementsDef)) {
      if (orbit.a * zoom < RING_MIN_PX)
        continue;
      const cosW = Math.cos(orbit.argPeriapsis);
      const sinW = Math.sin(orbit.argPeriapsis);
      const centerX = orbit.cx - orbit.a * orbit.e * cosW;
      const centerY = orbit.cy - orbit.a * orbit.e * sinW;
      const semiMinor = orbit.a * Math.sqrt(1 - orbit.e * orbit.e);
      let prevX = 0;
      let prevY = 0;
      for (let k = 0; k <= RING_SEGMENTS; k++) {
        const t = ((k % RING_SEGMENTS) / RING_SEGMENTS) * TAU;
        const lx = orbit.a * Math.cos(t);
        const ly = semiMinor * Math.sin(t);
        const x = centerX + lx * cosW - ly * sinW;
        const y = centerY + lx * sinW + ly * cosW;
        if (k > 0) {
          array[v * 3] = prevX;
          array[v * 3 + 1] = prevY;
          array[v * 3 + 2] = 0;
          v++;
          array[v * 3] = x;
          array[v * 3 + 1] = y;
          array[v * 3 + 2] = 0;
          v++;
        }
        prevX = x;
        prevY = y;
      }
    }
    mesh.geometry.setDrawRange(0, v);
    attribute.needsUpdate = true;
    mesh.visible = true;
  }
}
