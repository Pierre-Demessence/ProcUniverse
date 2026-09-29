/**
 * Lifecycle of the Three.js renderer: load its chunk on the first frame, show
 * its canvas only once it is ready, and report a failure once if loading or
 * initialisation fails (there is no other renderer to fall back to). The loader
 * is injected so this module never imports Three itself (the chunk stays lazy).
 */

/** The parts of `ThreeRenderer` this lifecycle needs. */
export interface ThreeRendererLike {
  readonly canvas: { style: { display: string } };
  readonly failed: boolean;
  readonly ready: boolean;
  dispose: () => void;
  resize: (w: number, h: number) => void;
}

export class ThreeBackend<R extends ThreeRendererLike> {
  private current: R | null = null;
  private lastActive = false;
  private readonly load: () => Promise<R>;
  private loadFailed = false;
  private loading = false;
  private readonly mount: (renderer: R) => void;
  private readonly onFail: () => void;
  private reportedFailure = false;

  constructor(load: () => Promise<R>, mount: (renderer: R) => void, onFail: () => void) {
    this.load = load;
    this.mount = mount;
    this.onFail = onFail;
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

  /** Advance one frame; returns whether Three is ready and draws this frame. */
  update(): boolean {
    const failed = this.loadFailed || (this.current?.failed ?? false);
    if (failed && !this.reportedFailure) {
      this.reportedFailure = true;
      this.onFail();
    }
    if (!failed && !this.current && !this.loading) {
      this.loading = true;
      this.load().then((renderer) => {
        this.current = renderer;
        this.mount(renderer);
      }).catch((error: unknown) => {
        // Don't re-request the chunk every frame; a page reload retries.
        this.loadFailed = true;
        this.loading = false;
        console.error('ProcUniverse: failed to load the Three.js renderer.', error);
      });
    }
    const active = !failed && this.current !== null && this.current.ready;
    if (this.current)
      this.current.canvas.style.display = active ? 'block' : 'none';
    this.lastActive = active;
    return active;
  }
}
