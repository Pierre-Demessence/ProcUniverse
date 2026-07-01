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

import { RenderableDef } from '@pierre/ecs/modules/render-canvas2d';
import { PositionDef } from '@pierre/ecs/modules/transform';
import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';

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

/** Per-frame inputs: the render-origin-frame camera and the ECS world. */
export interface ThreeRenderContext {
  camera: Camera;
  world: EcsWorld;
}

export class ThreeRenderer implements Renderer<ThreeRenderContext> {
  private readonly camera: OrthographicCamera;
  /** The WebGPU/WebGL canvas, positioned behind the 2D HUD canvas by the caller. */
  readonly canvas: HTMLCanvasElement;
  private readonly geometry: CircleGeometry;
  private readonly group: Group;
  private readonly pool: Mesh[] = [];
  /** True once `init()` has resolved; `render` is a no-op before then. */
  ready = false;
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;

  constructor() {
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
    this.renderer.init().then(() => {
      this.ready = true;
      // Report the active backend once so the WebGPU / WebGL2-fallback path is
      // verifiable in the console (Stage 0 "confirm both paths run").
      const which = this.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
      console.warn(`ProcUniverse: Three.js renderer ready (${which}).`);
    }).catch((error: unknown) => {
      console.error('ProcUniverse: Three.js renderer failed to initialise.', error);
    });
  }

  dispose(): void {
    for (const mesh of this.pool)
      (mesh.material as MeshBasicMaterial).dispose();
    this.geometry.dispose();
    this.renderer.dispose();
    this.canvas.remove();
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
