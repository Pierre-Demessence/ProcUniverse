/**
 * Bake a procedural planet surface into an equirectangular texture once, then
 * sample it on the sphere (docs/plans/planet-surfaces.md §3.2). Mipmapped +
 * anisotropic, so fine surface detail filters away cleanly when the planet is
 * only a few pixels wide instead of shimmering like per-pixel noise does.
 */

import type { Node } from 'three/webgpu';

import { cos, max, positionLocal, rtt, sin, smoothstep, transformNormalToView, uv, vec2, vec3 } from 'three/tsl';
import { LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three/webgpu';

/**
 * A procedural surface. `sample` maps a unit direction on the sphere
 * (sphere-local, +Y = spin pole) to `vec4(albedo rgb, height 0..1)`; the same
 * function feeds the baked and the per-pixel path.
 */
export interface PlanetSurface {
  /** Relief height in planet radii per unit of `height` (baked path only). */
  relief?: Node<'float'>;
  /** Self-glow computed from a sampled texel (e.g. lava), added over the lit albedo. */
  emissive?: (sampled: Node<'vec4'>) => Node<'vec3'>;
  sample: (dir: Node<'vec3'>) => Node<'vec4'>;
}

export interface SurfaceBake {
  /** Texture node (albedo rgb + height a) sampled with the mesh UVs. */
  node: Node<'vec4'>;
  dispose: () => void;
  /** Re-render the map on the next frame (after the surface's inputs changed). */
  invalidate: () => void;
  /** Local-frame shading normal from the baked height (`relief` radii per unit height), in view space. */
  reliefNormal: (relief: Node<'float'>) => Node<'vec3'>;
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
 * Bake `surface` into a `width × width/2` map. It renders lazily the first time
 * the returned node is drawn and again only after `invalidate()`.
 */
export function createSurfaceBake(surface: PlanetSurface, width: number): SurfaceBake {
  const height = width / 2;
  const node = rtt(surface.sample(sphereDirFromUv(uv())), width, height);
  node.autoUpdate = false;
  const texture = node.value;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  // Longitude wraps; filtering across u = 0/1 must too, or a seam line appears.
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = MAP_ANISOTROPY;

  // Relief from the sphere's own tangent frame rather than screen derivatives,
  // so bumps keep their strength at every zoom. Offsets sample the same mip the
  // pixel uses, so a small planet gets the smoothed (filtered) slope, not noise.
  const reliefNormal = (relief: Node<'float'>): Node<'vec3'> => {
    const coord = uv();
    const du = vec2(1 / width, 0);
    const dv = vec2(0, 1 / height);
    const dhdu = node.sample(coord.add(du)).a.sub(node.sample(coord.sub(du)).a).mul(width / 2);
    const dhdv = node.sample(coord.add(dv)).a.sub(node.sample(coord.sub(dv)).a).mul(height / 2);
    const n = positionLocal.normalize();
    // sin(colatitude); the east direction degenerates at the poles, so relief fades there.
    const s = max(n.xz.length(), 1e-3);
    const east = vec3(n.z, 0, n.x.negate()).div(s);
    const north = n.cross(east);
    const slope = east.mul(dhdu.div(s.mul(Math.PI * 2))).add(north.mul(dhdv.div(Math.PI)));
    const local = n.sub(slope.mul(relief).mul(smoothstep(0.02, 0.1, s))).normalize();
    return transformNormalToView(local);
  };

  return {
    node,
    reliefNormal,
    dispose: () => node.renderTarget?.dispose(),
    invalidate: () => {
      node.textureNeedsUpdate = true;
    },
  };
}
