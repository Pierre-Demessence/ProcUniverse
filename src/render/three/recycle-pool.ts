/**
 * Hands out recycled entries of a resource that is costly to build (a mesh with
 * its own GPU material) and takes them back, so entities streaming in and out
 * neither leak materials nor rebuild shaders.
 */
export class RecyclePool<T> {
  private readonly build: () => T;
  private readonly built: T[] = [];
  private readonly free: T[] = [];

  constructor(build: () => T) {
    this.build = build;
  }

  /** Visits every entry ever built, in use or free — for final disposal. */
  forEach(visit: (entry: T) => void): void {
    this.built.forEach(visit);
  }

  give(entry: T): void {
    this.free.push(entry);
  }

  take(): T {
    const reused = this.free.pop();
    if (reused !== undefined)
      return reused;
    const entry = this.build();
    this.built.push(entry);
    return entry;
  }
}
