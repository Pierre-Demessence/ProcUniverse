/**
 * Bake a procedural planet surface into an equirectangular texture once, then
 * sample it on the sphere (docs/plans/planet-surfaces.md §3.2). Mipmapped +
 * anisotropic, so fine surface detail filters away cleanly when the planet is
 * only a few pixels wide instead of shimmering like per-pixel noise does.
 */

import type { Node } from 'three/webgpu';

import { cos, rtt, sin, uv, vec3 } from 'three/tsl';
import { LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three/webgpu';

/**
 * A procedural surface: unit direction on the sphere (sphere-local, +Y = spin
 * pole) → albedo (raw sRGB rgb). The same function feeds both the per-pixel and
 * the baked path, so the two only differ in how they are sampled.
 */
export type AlbedoFn = (dir: Node<'vec3'>) => Node<'vec3'>;

export interface SurfaceBake {
  /** Texture node to use as a material `colorNode` (samples with the mesh UVs). */
  node: Node<'vec4'>;
  dispose: () => void;
  /** Re-render the map on the next frame (after the surface's inputs changed). */
  invalidate: () => void;
}

const MAP_ANISOTROPY = 8;

/** TSL mirror of `equirectDirection` in `planet-surface.ts` (unit-tested there). */
export function sphereDirFromUv(coord: Node<'vec2'>): Node<'vec3'> {
  const phi = coord.x.mul(Math.PI * 2);
  const theta = coord.y.oneMinus().mul(Math.PI);
  const s = sin(theta);
  return vec3(cos(phi).negate().mul(s), cos(theta), sin(phi).mul(s));
}

/**
 * Bake `albedo` into a `width × width/2` map. It renders lazily the first time
 * the returned node is drawn and again only after `invalidate()`.
 */
export function createSurfaceBake(albedo: AlbedoFn, width: number): SurfaceBake {
  const node = rtt(albedo(sphereDirFromUv(uv())), width, width / 2);
  node.autoUpdate = false;
  const texture = node.value;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  // Longitude wraps; filtering across u = 0/1 must too, or a seam line appears.
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = MAP_ANISOTROPY;
  return {
    node,
    dispose: () => node.renderTarget?.dispose(),
    invalidate: () => {
      node.textureNeedsUpdate = true;
    },
  };
}
