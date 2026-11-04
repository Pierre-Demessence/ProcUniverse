import type { SectorData, StarData } from '../../generation/universe';
import type { StarLayerFrame } from './star-sprites';

import { Group, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { STAR_LABEL_COUNT } from '../../config/render';
import { AU_PER_LY } from '../../generation/units';
import { StarSpriteLayer } from './star-sprites';

const LY = AU_PER_LY;

function system(scientific: string, x: number, y: number, z: number, luminosity = 1): StarData {
  return { name: { human: scientific, scientific }, star: { colorHex: '#ffffff', luminosity }, x, y, z } as unknown as StarData;
}

// A deterministic scatter of equal stars within 5 ly of the origin, so which
// stars look brightest depends only on where they are seen from.
function scatter(count: number): StarData[] {
  let state = 12345;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  return Array.from({ length: count }, (_, i) => system(`S-${i}`, (next() * 2 - 1) * 5 * LY, (next() * 2 - 1) * 5 * LY, (next() * 2 - 1) * 5 * LY));
}

// One sector holding every star, so the layer never generates anything.
function frame(stars: StarData[], cameraPosition: Vector3, overrides: Partial<StarLayerFrame> = {}): StarLayerFrame {
  const sector = { blackHoles: [], stars, sx: 0, sy: 0, sz: 0 } as SectorData;
  const cache = { get: () => sector, peek: () => sector };
  return {
    cache,
    cameraPosition,
    cameraQuaternion: new Quaternion(),
    focused: null,
    focusedWeight: 0,
    focusX: 0,
    focusY: 0,
    focusZ: 0,
    originX: 0,
    originY: 0,
    originZ: 0,
    pxFactor: 1000,
    range: { maxSx: 0, maxSy: 0, maxSz: 0, minSx: 0, minSy: 0, minSz: 0 },
    reach: 12 * LY,
    weight: 1,
    ...overrides,
  };
}

function labelled(layer: StarSpriteLayer): string[] {
  return layer.brightest([]).map(s => s.star.name.scientific).sort();
}

describe('starSpriteLayer', () => {
  it('labels the same stars wherever the camera orbits the focus', () => {
    const stars = scatter(60);
    const layer = new StarSpriteLayer(new Group());
    // Two camera positions on the same orbit around the focus, opposite sides.
    layer.fill(frame(stars, new Vector3(8 * LY, 0, 6 * LY)));
    const fromOneSide = labelled(layer);
    layer.fill(frame(stars, new Vector3(-8 * LY, 0, 6 * LY)));
    expect(fromOneSide).toHaveLength(STAR_LABEL_COUNT);
    expect(labelled(layer)).toEqual(fromOneSide);
    layer.dispose();
  });

  it('fades only the focused system, not another star sharing its catalogue name', () => {
    const focused = system('S-77777', 0, 0, 0);
    const namesake = system('S-77777', 2 * LY, 0, 0);
    const layer = new StarSpriteLayer(new Group());
    // A hidden focused sprite (its sphere still draws): only the namesake shows.
    const drawn = layer.fill(frame([focused, namesake], new Vector3(0, 0, 10 * LY), { focused, focusedWeight: 0 }));
    expect(drawn).toBe(1);
    expect(layer.brightest([])[0]?.x).toBe(2 * LY);
    layer.dispose();
  });
});
