/**
 * Shared lit planet material (docs/plans/planet-surfaces.md §3). Planets stay
 * lit by the star's point light — only the albedo changes — so the day/night
 * terminator keeps working. With no surface installed it is the flat fill the
 * system view has always drawn; later slices install a procedural surface.
 */

import type { AlbedoFn, SurfaceBake } from './surface-bake';

import { positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { PLANET_SURFACE_MAP_WIDTH } from '../../config/render';
import { createSurfaceBake } from './surface-bake';

/** Whether a surface is baked once into a mipmapped map or evaluated per pixel. */
export type AlbedoSource = 'baked' | 'per-pixel';

/** A planet material plus the setters the renderer (and the lab) drive it with. */
export interface PlanetMaterialHandle {
  material: MeshStandardNodeMaterial;
  dispose: () => void;
  /** Re-bake after the installed surface's inputs changed (no-op per pixel). */
  refreshSurface: () => void;
  /** Flat base colour (raw sRGB hex), shown while no surface is installed. */
  setFill: (colorHex: string) => void;
  /** Install a procedural surface, or `null` to return to the flat fill. */
  setSurface: (albedo: AlbedoFn | null, source?: AlbedoSource) => void;
}

/** One handle per planet mesh; a system holds only a handful of planets. */
export function createPlanetMaterial(): PlanetMaterialHandle {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  let bake: SurfaceBake | null = null;

  const dropBake = (): void => {
    bake?.dispose();
    bake = null;
  };

  return {
    material,
    refreshSurface: () => bake?.invalidate(),
    dispose: () => {
      dropBake();
      material.dispose();
    },
    setFill: (colorHex) => {
      material.color.set(colorHex);
    },
    setSurface: (albedo, source = 'baked') => {
      dropBake();
      if (albedo === null) {
        material.colorNode = null;
      }
      else if (source === 'baked') {
        bake = createSurfaceBake(albedo, PLANET_SURFACE_MAP_WIDTH);
        material.colorNode = bake.node;
      }
      else {
        material.colorNode = albedo(positionLocal.normalize());
      }
      material.needsUpdate = true;
    },
  };
}
