/**
 * Minimal type shim for the `three/webgpu` entry point. `three@0.184` ships no
 * bundled `.d.ts` and `@types/three` covers only the classic (WebGL) surface, so
 * `WebGPURenderer` is untyped. This re-exports the classic three types and
 * hand-declares the `WebGPURenderer` members this project uses. The runtime
 * module is resolved by the bundler from three's `exports` map; only the types
 * come from here. Extend as more of the WebGPU/TSL surface is adopted.
 */
declare module 'three/webgpu' {
  import type { Camera, ColorRepresentation, Scene } from 'three';

  export * from 'three';

  export interface WebGPURendererParameters {
    alpha?: boolean;
    antialias?: boolean;
    canvas?: HTMLCanvasElement;
    /** Force the WebGL2 backend even when WebGPU is available (testing/fallback). */
    forceWebGL?: boolean;
  }

  /**
   * Three's unified renderer: uses WebGPU when available and automatically falls
   * back to WebGL2 otherwise. Must be `await renderer.init()`-ed before the first
   * render.
   */
  export class WebGPURenderer {
    /** Present after {@link init}; discriminates the active backend. */
    readonly backend?: { isWebGLBackend?: boolean; isWebGPUBackend?: boolean };
    readonly domElement: HTMLCanvasElement;
    constructor(parameters?: WebGPURendererParameters);
    dispose(): void;
    init(): Promise<void>;
    render(scene: Scene, camera: Camera): void;
    setClearColor(color: ColorRepresentation, alpha?: number): void;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
  }
}
