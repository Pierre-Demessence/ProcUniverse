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

import type { PlanetPhysical } from '../../generation/planets';
import type { SectorCache } from '../../lod/sector-cache';
import type { SectorRange } from '../../lod/tier';
import type { BodyKind, PickResult } from '../../pick';
import type { OrbitElements } from '../../sim/orbits';
import type { GlowField } from './glow-fields';
import type { PlanetMaterialHandle } from './planet-material';
import type { RingMaterialHandle } from './planet-rings';
import type { StarMaterialHandle } from './star-material';
import type { StarfieldDome } from './starfield';

import { worldToView } from '@pierre/ecs/modules/camera';
import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';
import { AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ColorManagement, DoubleSide, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Raycaster, RenderPipeline, RingGeometry, Scene, SphereGeometry, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';

import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, CAMERA_FOV_DEG, LIGHT_AMBIENT, LIGHT_STAR_BASE, RENDER_ANTIALIAS, RENDER_SCALE, SPHERE_HEIGHT_SEGMENTS, SPHERE_WIDTH_SEGMENTS, STAR_EMISSIVE_STRENGTH, STAR_MIN_SCREEN_PX, STAR_SPIN_RATE } from '../../config/render';
import { BlackHoleDef, galaxyAt } from '../../generation/galaxies';
import { MoonPhysicalDef } from '../../generation/moons';
import { oblateness, PlanetPhysicalDef } from '../../generation/planets';
import { StarPhysicalDef } from '../../generation/stars';
import { OrbitElementsDef, PositionZDef, ringSegmentCount, tiltNormal } from '../../sim/orbits';
import { oblatePolarScale } from '../body-scale';
import { perspectiveClipPlanes } from './clip-planes';
import { forEachGalaxyFieldGlow, forEachGalaxyGlow, forEachUniverseGlow } from './glow-fields';
import { createPlanetMaterial } from './planet-material';
import { createRingMaterial, RING_INNER_FRAC, RING_SEGMENTS, ringOuterRadius, ringVariety } from './planet-rings';
import { createStarMaterial } from './star-material';
import { starLightIntensity } from './star-surface';
import { createStarfieldDome } from './starfield';

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
/** A UV sphere's north pole is its local +Y axis; planet spheres are re-oriented so this points along the spin axis. */
const SPHERE_POLE = new Vector3(0, 1, 0);
/** A ring lies in its local XY plane (normal +Z); it is re-oriented so +Z points along the planet's spin axis. */
const RING_POLE = new Vector3(0, 0, 1);
/** Dark grey for the black-hole sphere so it reads as a shaded body, not black-on-black. */
const BLACK_HOLE_COLOR = '#15151c';
/** Orbit-ring line resolution + faint styling; mirrors the 2D `drawOrbitRings`. */
const RING_MIN_PX = 3;
// Cull a ring whose bounding circle is more than this many viewport-spans from
// the focus. Generous so a tilted perspective view (which sees further than the
// top-down footprint) never pops a visible ring, while still dropping the rings
// of a system panned out of view.
const RING_CULL_MARGIN = 3;
const RING_COLOR = 0x96B4E6;
const RING_OPACITY = 0.14;
/** Initial merged-ring vertex capacity; grown on demand. */
const RING_INITIAL_VERTS = 8192;
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
  focusZ: number;
  /** Unit normal of the focused system's orbital plane; the orbit camera looks down it. */
  planeNormal: readonly [number, number, number];
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
  /** True when `init()` rejected (no usable WebGPU / WebGL2); the renderer never becomes ready. */
  failed = false;
  private glowCapacity = 0;
  private readonly glowGeometry: PlaneGeometry;
  private readonly glowMaterial: MeshBasicMaterial;
  private glowMesh: InstancedMesh | null = null;
  private readonly glowTexture: CanvasTexture;
  private readonly group: Group;
  private readonly perspective: PerspectiveCamera;
  /** Post-process pipeline (scene → bloom) for the system tier; null until ready. */
  private pipeline: RenderPipeline | null = null;
  /** Shared unit-ring geometry for planet rings (scaled per planet). */
  private readonly planetRingGeometry: RingGeometry;
  /** Pooled ring materials + meshes for planets with rings; surplus hidden each frame. */
  private readonly planetRingPool: { handle: RingMaterialHandle; mesh: Mesh }[] = [];
  /** Planet spheres get the shared planet-surface material (not the generic lit pool). */
  private readonly planetSpherePool: { handle: PlanetMaterialHandle; mesh: Mesh }[] = [];
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
  private starfieldDome: StarfieldDome | null = null;
  private readonly starGeometry: CircleGeometry;
  /**
   * A single point light for the system in view, placed at the star nearest the
   * camera focus. One light (not one per star) so the many stars streamed into
   * the world — neighbouring systems, frustum-clipped from view — cannot stack
   * their (decay-free, infinite-reach) illumination and blow the planets out.
   */
  private starLight: PointLight | null = null;
  private readonly starMaterial: MeshBasicMaterial;
  private starMesh: InstancedMesh | null = null;
  /** Star spheres get a dedicated procedural material (not the shared lit pool). */
  private readonly starSpherePool: { handle: StarMaterialHandle; mesh: Mesh }[] = [];
  private readonly tmpAxis = new Vector3();
  private readonly tmpColor = new Color();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpQuat2 = new Quaternion();
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
    this.planetRingGeometry = new RingGeometry(RING_INNER_FRAC, 1, RING_SEGMENTS);
    this.glowTexture = makeGlowTexture();
    this.glowGeometry = new PlaneGeometry(1, 1);
    this.glowMaterial = new MeshBasicMaterial({ blending: AdditiveBlending, depthTest: false, depthWrite: false, map: this.glowTexture, side: DoubleSide, transparent: true });
    // Ambient fills the star-facing-away side just enough to stay readable; the
    // directional key from the previous prototype is replaced by a single point
    // light placed at the star nearest the focus (created on demand in `render`),
    // so bodies are lit from the actual star and the lit face tracks their orbit.
    this.scene.add(new AmbientLight(0xFFFFFF, LIGHT_AMBIENT));
    this.ringMaterial = new LineBasicMaterial({ color: RING_COLOR, opacity: RING_OPACITY, transparent: true });
    this.renderer.init().then(() => {
      this.ready = true;
      // Record + report the active backend so the WebGPU / WebGL2-fallback path
      // is verifiable in the console and shown in the HUD renderer indicator.
      // `isWebGPUBackend` lives on the concrete WebGPU backend, not the base type.
      const backend = this.renderer.backend as { isWebGPUBackend?: boolean } | undefined;
      this.backendLabel = backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
      console.warn(`ProcUniverse: Three.js renderer ready (${this.backendLabel}).`);
      // System-tier post-processing: render the scene, then add a bloom of its
      // HDR-bright pixels (the stars) so they gain a corona. Built once the
      // renderer is initialised; the glow tiers keep rendering directly.
      const scenePass = pass(this.scene, this.perspective);
      const bloomPass = bloom(scenePass, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      const pipeline = new RenderPipeline(this.renderer);
      pipeline.outputNode = scenePass.add(bloomPass);
      this.pipeline = pipeline;
    }).catch((error: unknown) => {
      this.failed = true;
      console.error('ProcUniverse: Three.js renderer failed to initialise.', error);
    });
  }

  dispose(): void {
    this.starfieldDome?.dispose();
    this.pipeline?.dispose();
    for (const mesh of this.pool)
      (mesh.material as MeshStandardMaterial).dispose();
    for (const entry of this.starSpherePool)
      entry.handle.dispose();
    for (const entry of this.planetSpherePool)
      entry.handle.dispose();
    if (this.starLight)
      this.scene.remove(this.starLight);
    this.starMesh?.dispose();
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.glowMesh?.dispose();
    this.glowGeometry.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
    this.sphereGeometry.dispose();
    for (const entry of this.planetRingPool)
      entry.handle.dispose();
    this.planetRingGeometry.dispose();
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

  /** Ensure the merged ring buffer holds ≥ `vertexCount` line vertices, growing on demand. */
  private ensureRingMesh(vertexCount: number): LineSegments {
    if (this.ringMesh && this.ringCapacity >= vertexCount)
      return this.ringMesh;
    if (this.ringMesh) {
      this.scene.remove(this.ringMesh);
      this.ringMesh.geometry.dispose();
    }
    const capacity = Math.max(RING_INITIAL_VERTS, nextPowerOfTwo(vertexCount));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 3), 3));
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

  /** Reuse a pooled ring (its own material + a shared geometry), creating one on first use. */
  private obtainPlanetRing(index: number): { handle: RingMaterialHandle; mesh: Mesh } {
    let entry = this.planetRingPool[index];
    if (!entry) {
      const handle = createRingMaterial();
      const mesh = new Mesh(this.planetRingGeometry, handle.material);
      entry = { handle, mesh };
      this.planetRingPool.push(entry);
      this.group.add(mesh);
    }
    entry.mesh.visible = true;
    return entry;
  }

  /** Reuse a pooled planet sphere (shared planet material), creating one on first use. */
  private obtainPlanetSphere(index: number): { handle: PlanetMaterialHandle; mesh: Mesh } {
    let entry = this.planetSpherePool[index];
    if (!entry) {
      const handle = createPlanetMaterial();
      const mesh = new Mesh(this.sphereGeometry, handle.material);
      entry = { handle, mesh };
      this.planetSpherePool.push(entry);
      this.group.add(mesh);
    }
    entry.mesh.visible = true;
    return entry;
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

  /** The system's single star light, created (decay-free) on first use. */
  private obtainStarLight(): PointLight {
    if (!this.starLight) {
      // decay = 0: constant across the system so every planet stays lit
      // (readability over strict inverse-square; a tuning call per the plan).
      this.starLight = new PointLight(0xFFFFFF, LIGHT_STAR_BASE, 0, 0);
      this.scene.add(this.starLight);
    }
    this.starLight.visible = true;
    return this.starLight;
  }

  /** Reuse a pooled star sphere (procedural self-lit material), creating one on first use. */
  private obtainStarSphere(index: number): { handle: StarMaterialHandle; mesh: Mesh } {
    let entry = this.starSpherePool[index];
    if (!entry) {
      const handle = createStarMaterial(STAR_EMISSIVE_STRENGTH);
      const mesh = new Mesh(this.sphereGeometry, handle.material);
      entry = { handle, mesh };
      this.starSpherePool.push(entry);
      this.group.add(mesh);
    }
    entry.mesh.visible = true;
    return entry;
  }

  /**
   * Orient a planet sphere so its pole points along its spin axis — the orbital
   * plane normal tilted by the axial obliquity around the stored azimuth — then
   * spin it about that axis. That is the same plane its (equatorial-orbit) moons
   * ride in, so a tilted planet and its moon disk visibly agree.
   */
  private orientPlanet(mesh: Mesh, planet: PlanetPhysical, orbit: OrbitElements, simSeconds: number): void {
    this.planetSpinAxis(planet, orbit, this.tmpAxis);
    this.tmpQuat.setFromUnitVectors(SPHERE_POLE, this.tmpAxis);
    const spin = (simSeconds / (planet.rotationPeriod * 3600)) * TAU;
    this.tmpQuat2.setFromAxisAngle(this.tmpAxis, spin);
    mesh.quaternion.multiplyQuaternions(this.tmpQuat2, this.tmpQuat);
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
    const targets = this.group.children.filter(child => child.visible && (child.userData as { kind?: BodyKind }).kind !== undefined);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit)
      return null;
    const data = hit.object.userData as { id?: number; kind?: BodyKind };
    return data.id === undefined || data.kind === undefined ? null : { id: data.id, kind: data.kind };
  }

  /** The planet's spin axis: its orbit-plane normal tilted by obliquity around its azimuth. */
  private planetSpinAxis(planet: PlanetPhysical, orbit: OrbitElements, out: Vector3): void {
    const sinI = Math.sin(orbit.inclination);
    const nx = sinI * Math.sin(orbit.longitudeAscendingNode);
    const ny = -sinI * Math.cos(orbit.longitudeAscendingNode);
    const nz = Math.cos(orbit.inclination);
    const [sx, sy, sz] = tiltNormal(nx, ny, nz, planet.obliquity * DEG2RAD, planet.obliquityAzimuth);
    out.set(sx, sy, sz);
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
   * render-origin frame; orbits stay coplanar (z=0). Stars use a procedural
   * self-lit surface shader and light their planets/moons via a point light at
   * the star; the black hole is a dark shaded sphere. Bodies reuse pooled sphere
   * meshes; the surplus is hidden.
   */
  render(ctx: ThreeRenderContext): void {
    if (!this.ready)
      return;
    const { azimuth, camera, focusZ, planeNormal, simSeconds, tilt, world } = ctx;
    this.group.visible = true;
    if (this.starMesh)
      this.starMesh.visible = false;
    if (this.glowMesh)
      this.glowMesh.visible = false;

    const renderables = world.getStore(RenderableDef);
    const positions = world.getStore(PositionDef);
    const positionsZ = world.getStore(PositionZDef);
    const planets = world.getStore(PlanetPhysicalDef);
    const stars = world.getStore(StarPhysicalDef);
    const orbits = world.getStore(OrbitElementsDef);
    const focusX = camera.x + camera.offsetX;
    const focusY = camera.y + camera.offsetY;
    // Frustum reach = the focused system only (nearest star + the widest planet
    // apoapsis), so the perspective far plane stays tight and neighbouring
    // systems — light-years away — are clipped rather than drawn (bodies and
    // labels) behind the current one.
    const sceneRadius = this.focusedSystemReach(world, focusX, focusY);
    // Position the perspective camera up front: the star size-floor below needs
    // the camera's world position, and nothing between here and the final draw
    // depends on the previous frame's camera.
    this.syncPerspective(camera, azimuth, tilt, sceneRadius, focusZ, planeNormal);
    // Anchor the starfield sky to the camera and fit its radius just inside the
    // far plane so it renders as a background: solid content (planets/stars) is
    // closer and occludes it via the depth test, while the sky fills everywhere
    // else. (A fixed origin-centred dome would fall beyond the far plane and be
    // clipped away.)
    if (this.starfieldDome) {
      const p = this.perspective;
      this.starfieldDome.place(p.position.x, p.position.y, p.position.z, p.far * 0.95);
      this.starfieldDome.setVisible(true);
    }
    // World units per screen pixel factor: an object of world radius r at camera
    // distance d spans `pxFactor · r / d` pixels tall-half. Used to floor a
    // star's on-screen size so a distant star never shrinks to nothing.
    const pxFactor = this.viewH / (2 * Math.tan((CAMERA_FOV_DEG * DEG2RAD) / 2));
    let used = 0;
    let planetsUsed = 0;

    const place = (id: number, kind: BodyKind, colorOverride: string | null): Mesh | null => {
      const renderable = renderables.get(id);
      const position = positions.get(id);
      if (!renderable || renderable.kind !== 'circle' || !position)
        return null;
      const fill = colorOverride ?? renderable.fill ?? DEFAULT_FILL;
      let mesh: Mesh;
      if (kind === 'planet') {
        const entry = this.obtainPlanetSphere(planetsUsed++);
        entry.handle.setFill(fill);
        mesh = entry.mesh;
      }
      else {
        mesh = this.obtainSphere(used++);
        (mesh.material as MeshStandardMaterial).color.set(fill);
      }
      mesh.position.set(position.x, position.y, positionsZ.get(id)?.z ?? 0);
      mesh.scale.setScalar(renderable.radius);
      const data = mesh.userData as { id: number; kind: BodyKind };
      data.id = id;
      data.kind = kind;
      return mesh;
    };

    const starSpin = simSeconds * STAR_SPIN_RATE;
    const wallClock = performance.now() / 1000;
    let starsUsed = 0;
    // Track the star nearest the camera focus — the system in view — to carry
    // the single scene light (see `starLight`).
    let nearestStarD2 = Infinity;
    let litColor: string | null = null;
    let litLuminosity = 0;
    for (const [id] of world.query(StarPhysicalDef)) {
      const renderable = renderables.get(id);
      const position = positions.get(id);
      const star = stars.get(id);
      if (!renderable || renderable.kind !== 'circle' || !position || !star)
        continue;
      const { handle, mesh } = this.obtainStarSphere(starsUsed);
      mesh.position.set(position.x, position.y, positionsZ.get(id)?.z ?? 0);
      // Floor the on-screen size: a star's true disc shrinks below a pixel from
      // a distant planet and vanishes, but a real star stays a bright glare
      // point — so never draw it smaller than `STAR_MIN_SCREEN_PX` (bloom then
      // turns the floored dot into a visible glow). Guard the pre-resize case
      // where `pxFactor` is 0 (avoids an infinite radius).
      const distToCam = this.perspective.position.distanceTo(mesh.position);
      const minRadius = pxFactor > 0 ? (STAR_MIN_SCREEN_PX * distToCam) / pxFactor : 0;
      mesh.scale.setScalar(Math.max(renderable.radius, minRadius));
      mesh.rotation.set(0, starSpin, 0);
      handle.setStar(renderable.fill ?? DEFAULT_FILL, star.temperature);
      handle.setTime(wallClock);
      const data = mesh.userData as { id: number; kind: BodyKind };
      data.id = id;
      data.kind = 'star';
      const dx = position.x - focusX;
      const dy = position.y - focusY;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestStarD2) {
        nearestStarD2 = d2;
        litColor = renderable.fill ?? DEFAULT_FILL;
        litLuminosity = star.luminosity;
        this.tmpVec.copy(mesh.position);
      }
      starsUsed++;
    }
    // One light at the focused system's star, tinted + scaled to it. Lights the
    // planets/moons on their star-facing side without stacking (see `starLight`).
    if (litColor !== null) {
      const light = this.obtainStarLight();
      light.position.copy(this.tmpVec);
      light.color.set(litColor);
      light.intensity = starLightIntensity(litLuminosity, LIGHT_STAR_BASE);
    }
    else if (this.starLight) {
      this.starLight.visible = false;
    }
    for (const [id] of world.query(PlanetPhysicalDef)) {
      const mesh = place(id, 'planet', null);
      if (!mesh)
        continue;
      const planet = planets.get(id);
      const orbit = orbits.get(id);
      // Squash the sphere at its equator by its rotational flattening: the drawn
      // radius is the equatorial radius, and the local +Y axis (which
      // `orientPlanet` aligns to the spin axis) is shortened to the polar radius.
      if (planet)
        mesh.scale.y = mesh.scale.x * oblatePolarScale(oblateness(planet.rotationPeriod, planet.mass, planet.radius));
      if (planet && orbit)
        this.orientPlanet(mesh, planet, orbit, simSeconds);
      else
        mesh.rotation.set(0, 0, 0);
    }
    // Rings: a translucent disc in each ringed planet's equatorial plane, scaled
    // to the planet's drawn radius and oriented on its spin axis, lit by the star
    // with the planet's shadow band carved across it and coloured by temperature.
    let ringsUsed = 0;
    const ringStar = this.starLight;
    const ringShadow = ringStar && ringStar.visible ? 1 : 0;
    for (const [id] of world.query(PlanetPhysicalDef)) {
      const planet = planets.get(id);
      if (!planet || !planet.hasRings)
        continue;
      const renderable = renderables.get(id);
      const position = positions.get(id);
      const orbit = orbits.get(id);
      if (!renderable || renderable.kind !== 'circle' || !position || !orbit)
        continue;
      const { handle, mesh } = this.obtainPlanetRing(ringsUsed++);
      mesh.position.set(position.x, position.y, positionsZ.get(id)?.z ?? 0);
      mesh.scale.setScalar(ringOuterRadius(renderable.radius, ringVariety(planet.mass, planet.equilibriumTemp)));
      this.planetSpinAxis(planet, orbit, this.tmpAxis);
      mesh.quaternion.setFromUnitVectors(RING_POLE, this.tmpAxis);
      handle.setRing(mesh.position, renderable.radius, ringStar ? ringStar.position : mesh.position, ringShadow, planet.mass, planet.equilibriumTemp);
    }
    for (let i = ringsUsed; i < this.planetRingPool.length; i++) {
      const entry = this.planetRingPool[i];
      if (entry)
        entry.mesh.visible = false;
    }
    for (const [id] of world.query(MoonPhysicalDef))
      place(id, 'moon', null)?.rotation.set(0, 0, 0);
    for (const [id] of world.query(BlackHoleDef))
      place(id, 'black-hole', BLACK_HOLE_COLOR)?.rotation.set(0, 0, 0);

    for (let i = used; i < this.pool.length; i++) {
      const mesh = this.pool[i];
      if (mesh)
        mesh.visible = false;
    }
    for (let i = starsUsed; i < this.starSpherePool.length; i++) {
      const entry = this.starSpherePool[i];
      if (entry)
        entry.mesh.visible = false;
    }
    for (let i = planetsUsed; i < this.planetSpherePool.length; i++) {
      const entry = this.planetSpherePool[i];
      if (entry)
        entry.mesh.visible = false;
    }

    this.updateOrbitRings(world, camera);
    // Render through the bloom pipeline once built; the scene pass inside it
    // uses the perspective camera positioned above.
    if (this.pipeline)
      this.pipeline.render();
    else
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
    this.starfieldDome?.setVisible(false);
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
    this.starfieldDome?.setVisible(false);
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
   * matches the 2D view. The orbit is anchored to the focused system's plane:
   * `tilt` is the polar angle away from the plane normal (0 = looking straight
   * down it, so orbits read as circles) and `azimuth` swings around it. `up` is
   * the plane normal, so a near-zero tilt reads as a true top-down of the system
   * regardless of how the disk is oriented in space.
   */
  private syncPerspective(camera: Camera, azimuth: number, tilt: number, sceneRadius: number, focusZ: number, planeNormal: readonly [number, number, number]): void {
    const fovRad = CAMERA_FOV_DEG * DEG2RAD;
    const halfHeightWorld = camera.viewportH / camera.zoom / 2;
    const distance = halfHeightWorld / Math.tan(fovRad / 2);
    const focusX = camera.x + camera.offsetX;
    const focusY = camera.y + camera.offsetY;
    // Plane-anchored basis (u, v, N): N is the system's disk normal, and (u, v)
    // span the plane. The camera offset from the focus is a tilt away from N
    // toward the azimuth direction in the plane, so at tilt→0 it sits on N and
    // looks straight down the disk (orbits appear as circles about the star).
    const [nx, ny, nz] = planeNormal;
    // Reference axis not parallel to N, to seed an in-plane basis via cross products.
    const refZ = Math.abs(nz) < 0.999 ? 1 : 0;
    const refX = refZ === 1 ? 0 : 1;
    // u = ref × N, normalised.
    let ux = -refZ * ny;
    let uy = refZ * nx - refX * nz;
    let uz = refX * ny;
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen;
    uy /= ulen;
    uz /= ulen;
    // v = N × u (already unit since N ⟂ u are orthonormal).
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const sinTilt = Math.sin(tilt);
    const cosTilt = Math.cos(tilt);
    const cosA = Math.cos(azimuth);
    const sinA = Math.sin(azimuth);
    // Offset direction from focus to camera in the plane-anchored basis.
    const ox = sinTilt * (cosA * ux + sinA * vx) + cosTilt * nx;
    const oy = sinTilt * (cosA * uy + sinA * vy) + cosTilt * ny;
    const oz = sinTilt * (cosA * uz + sinA * vz) + cosTilt * nz;
    const p = this.perspective;
    p.fov = CAMERA_FOV_DEG;
    p.aspect = camera.viewportW / Math.max(1, camera.viewportH);
    const { far, near } = perspectiveClipPlanes(distance, halfHeightWorld, sceneRadius);
    p.near = near;
    p.far = far;
    p.position.set(focusX + distance * ox, focusY + distance * oy, focusZ + distance * oz);
    p.up.set(nx, ny, nz);
    p.lookAt(focusX, focusY, focusZ);
    p.updateProjectionMatrix();
  }

  /**
   * Rebuild every visible orbit ring into a single merged `LineSegments` — one
   * draw call and one buffer upload regardless of orbit count (individual line
   * objects were per-object overhead that scaled with zoom). Mirrors the 2D
   * `drawOrbitRings` ellipse (centre offset a·e away from periapsis, semi-minor
   * a·√(1−e²), rotated by argPeriapsis) in the z=0 plane. Rings whose bounding
   * circle is fully off-screen are culled (as in the 2D path), and the per-orbit
   * orientation trig is hoisted out of the per-segment loop, so a system zoomed
   * right in (huge on-screen orbits, most off-screen) stays cheap.
   */
  private updateOrbitRings(world: EcsWorld, cam: Camera): void {
    const zoom = cam.zoom;
    const focusX = cam.x + cam.offsetX;
    const focusY = cam.y + cam.offsetY;
    const visibleRadius = (Math.max(cam.viewportW, cam.viewportH) / zoom) * RING_CULL_MARGIN;
    // A ring is worth drawing when it is big enough on screen AND its bounding
    // circle (focus ± apoapsis) reaches the visible region.
    const isVisible = (orbit: OrbitElements): boolean => {
      if (orbit.a * zoom < RING_MIN_PX)
        return false;
      const apoapsisAu = orbit.a * (1 + orbit.e);
      return Math.hypot(orbit.cx - focusX, orbit.cy - focusY) - apoapsisAu <= visibleRadius;
    };

    // First pass: total line vertices needed (2 per segment), with each ring's
    // segment count adapted to its on-screen size so it stays smooth at any zoom.
    let totalVerts = 0;
    for (const [, orbit] of world.query(OrbitElementsDef)) {
      if (isVisible(orbit))
        totalVerts += ringSegmentCount(orbit.a * zoom) * 2;
    }
    if (totalVerts === 0) {
      if (this.ringMesh)
        this.ringMesh.visible = false;
      return;
    }

    const mesh = this.ensureRingMesh(totalVerts);
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    let v = 0;
    for (const [, orbit] of world.query(OrbitElementsDef)) {
      if (!isVisible(orbit))
        continue;
      const segments = ringSegmentCount(orbit.a * zoom);
      // Hoist the ellipse + perifocal→world orientation constants out of the loop
      // (writeOrbitEllipsePoint recomputes all six trig terms per point). The body
      // below mirrors `perifocalToWorld`: x' = a·cosθ − a·e, y' = b·sinθ, then
      // R_z(Ω)·R_x(i)·R_z(ω) + focus.
      const { a, argPeriapsis, cx, cy, cz, e, inclination, longitudeAscendingNode } = orbit;
      const semiMinor = a * Math.sqrt(1 - e * e);
      const focalShift = a * e;
      const cosW = Math.cos(argPeriapsis);
      const sinW = Math.sin(argPeriapsis);
      const cosI = Math.cos(inclination);
      const sinI = Math.sin(inclination);
      const cosO = Math.cos(longitudeAscendingNode);
      const sinO = Math.sin(longitudeAscendingNode);
      let prevX = 0;
      let prevY = 0;
      let prevZ = 0;
      for (let k = 0; k <= segments; k++) {
        const theta = ((k % segments) / segments) * TAU;
        const xOrbit = a * Math.cos(theta) - focalShift;
        const yOrbit = semiMinor * Math.sin(theta);
        const x1 = xOrbit * cosW - yOrbit * sinW;
        const y1 = xOrbit * sinW + yOrbit * cosW;
        const y2 = y1 * cosI;
        const z2 = y1 * sinI;
        const px = cx + x1 * cosO - y2 * sinO;
        const py = cy + x1 * sinO + y2 * cosO;
        const pz = cz + z2;
        if (k > 0) {
          array[v * 3] = prevX;
          array[v * 3 + 1] = prevY;
          array[v * 3 + 2] = prevZ;
          v++;
          array[v * 3] = px;
          array[v * 3 + 1] = py;
          array[v * 3 + 2] = pz;
          v++;
        }
        prevX = px;
        prevY = py;
        prevZ = pz;
      }
    }
    mesh.geometry.setDrawRange(0, v);
    attribute.needsUpdate = true;
    mesh.visible = true;
  }

  /**
   * Update the background starfield dome for the current galaxy context.
   * Called once per frame before any tier-specific render.
   *
   * `renderOriginX`, `renderOriginY` — the floating render origin (AU).
   * `camAbsX`, `camAbsY` — absolute camera position (AU), for galaxy lookup.
   */
  updateStarfield(seed: number, renderOriginX: number, renderOriginY: number, camAbsX: number, camAbsY: number): void {
    if (!this.ready)
      return;
    if (!this.starfieldDome) {
      this.starfieldDome = createStarfieldDome();
      this.scene.add(this.starfieldDome.object);
    }
    const g = galaxyAt(seed, camAbsX, camAbsY);
    this.starfieldDome.update(
      seed,
      g
        ? {
            centerX: g.centerX - renderOriginX,
            centerY: g.centerY - renderOriginY,
            orientation: g.orientation,
            void: false,
          }
        : { centerX: 0, centerY: 0, orientation: 0, void: true },
      camAbsX,
      camAbsY,
    );
  }
}
