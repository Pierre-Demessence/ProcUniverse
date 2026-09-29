/**
 * Lifecycle of the optional Three.js renderer: load its chunk the first time it
 * is wanted, show its canvas only once it is ready, and fall back to Canvas 2D
 * for the rest of the session if loading or initialisation fails. The loader is
 * injected so this module never imports Three itself (the chunk stays lazy).
 */

/** The parts of `ThreeRenderer` this lifecycle needs. */
export interface ThreeRendererLike {
  readonly canvas: { style: { display: string } };
  readonly failed: boolean;
  readonly ready: boolean;
  dispose: () => void;
  resize: (w: number, h: number) => void;
}

/** Per-frame backend state. */
export interface BackendFrame {
  /** Three is ready and draws this frame. */
  active: boolean;
  /** `active` differs from the previous frame. */
  changed: boolean;
  /** Three is selected and has not failed: keep the 2D canvas transparent. */
  threeMode: boolean;
}

export class ThreeBackend<R extends ThreeRendererLike> {
  private current: R | null = null;
  private lastActive = false;
  private readonly load: () => Promise<R>;
  private loadFailed = false;
  private loading = false;
  private readonly mount: (renderer: R) => void;

  constructor(load: () => Promise<R>, mount: (renderer: R) => void) {
    this.load = load;
    this.mount = mount;
  }

  get active(): boolean {
    return this.lastActive;
  }

  dispose(): void {
    this.current?.dispose();
  }

  get renderer(): R | null {
    return this.current;
  }

  resize(w: number, h: number): void {
    this.current?.resize(w, h);
  }

  /** Advance one frame; `wanted` is whether the user selected the Three backend. */
  update(wanted: boolean): BackendFrame {
    const failed = this.loadFailed || (this.current?.failed ?? false);
    const threeMode = wanted && !failed;
    if (threeMode && !this.current && !this.loading) {
      this.loading = true;
      this.load().then((renderer) => {
        this.current = renderer;
        this.mount(renderer);
      }).catch((error: unknown) => {
        // Fall back to Canvas 2D rather than re-requesting the chunk every frame;
        // a page reload retries.
        this.loadFailed = true;
        this.loading = false;
        console.error('ProcUniverse: failed to load the Three.js backend.', error);
      });
    }
    const active = threeMode && this.current !== null && this.current.ready;
    if (this.current)
      this.current.canvas.style.display = active ? 'block' : 'none';
    const changed = active !== this.lastActive;
    this.lastActive = active;
    return { active, changed, threeMode };
  }
}
