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

function setup(load: () => Promise<FakeRenderer>) {
  const mount = vi.fn();
  const onFail = vi.fn();
  return { backend: new ThreeBackend(load, mount, onFail), mount, onFail };
}

describe('threeBackend', () => {
  it('loads once and activates when ready', async () => {
    const r = fakeRenderer();
    const load = vi.fn(async () => r);
    const { backend, mount } = setup(load);
    expect(backend.update()).toBe(false);
    backend.update();
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(mount).toHaveBeenCalledWith(r);
    expect(backend.update()).toBe(false);
    expect(r.canvas.style.display).toBe('none');
    r.ready = true;
    expect(backend.update()).toBe(true);
    expect(r.canvas.style.display).toBe('block');
    expect(backend.active).toBe(true);
  });

  it('reports a chunk load failure once without retrying', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(async () => {
      throw new Error('network');
    });
    const { backend, onFail } = setup(load);
    backend.update();
    await flush();
    expect(backend.update()).toBe(false);
    backend.update();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('reports a renderer initialisation failure once and hides its canvas', async () => {
    const r = fakeRenderer();
    const { backend, onFail } = setup(async () => r);
    backend.update();
    await flush();
    r.failed = true;
    expect(backend.update()).toBe(false);
    backend.update();
    expect(r.canvas.style.display).toBe('none');
    expect(onFail).toHaveBeenCalledTimes(1);
  });
});
