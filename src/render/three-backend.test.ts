import type { ThreeRendererLike } from './three-backend';

import { describe, expect, it, vi } from 'vitest';

import { ThreeBackend } from './three-backend';

interface FakeRenderer extends ThreeRendererLike {
  canvas: { style: { display: string } };
  failed: boolean;
  ready: boolean;
}

function fakeRenderer(): FakeRenderer {
  return { canvas: { style: { display: '' } }, dispose: vi.fn(), failed: false, ready: false, resize: vi.fn() };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function setup(load: () => Promise<FakeRenderer>): { backend: ThreeBackend<FakeRenderer>; mount: ReturnType<typeof vi.fn> } {
  const mount = vi.fn();
  return { backend: new ThreeBackend(load, mount), mount };
}

describe('threeBackend', () => {
  it('never loads while Canvas 2D is wanted', () => {
    const load = vi.fn(async () => fakeRenderer());
    const { backend } = setup(load);
    expect(backend.update(false)).toEqual({ active: false, changed: false, threeMode: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('loads once, stays in threeMode while loading, and activates when ready', async () => {
    const r = fakeRenderer();
    const load = vi.fn(async () => r);
    const { backend, mount } = setup(load);
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: true });
    backend.update(true);
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(mount).toHaveBeenCalledWith(r);
    expect(backend.update(true).active).toBe(false);
    expect(r.canvas.style.display).toBe('none');
    r.ready = true;
    expect(backend.update(true)).toEqual({ active: true, changed: true, threeMode: true });
    expect(backend.update(true).changed).toBe(false);
    expect(r.canvas.style.display).toBe('block');
    expect(backend.active).toBe(true);
  });

  it('falls back to Canvas 2D without retrying when the chunk fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(async () => {
      throw new Error('network');
    });
    const { backend } = setup(load);
    backend.update(true);
    await flush();
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: false });
    backend.update(true);
    expect(load).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('falls back to Canvas 2D when the renderer fails to initialise', async () => {
    const r = fakeRenderer();
    const { backend } = setup(async () => r);
    backend.update(true);
    await flush();
    r.failed = true;
    expect(backend.update(true)).toEqual({ active: false, changed: false, threeMode: false });
    expect(r.canvas.style.display).toBe('none');
  });

  it('deactivates and hides its canvas when Canvas 2D is chosen again', async () => {
    const r = fakeRenderer();
    const { backend } = setup(async () => r);
    backend.update(true);
    await flush();
    r.ready = true;
    backend.update(true);
    expect(backend.update(false)).toEqual({ active: false, changed: true, threeMode: false });
    expect(r.canvas.style.display).toBe('none');
  });
});
