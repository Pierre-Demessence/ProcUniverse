/**
 * Shared lit planet material (docs/plans/planet-surfaces.md §3). Planets stay
 * lit by the star's point light — only the albedo (plus relief and any thermal
 * glow) changes — so the day/night terminator keeps working. Planet types
 * without a surface slice yet keep the flat fill.
 */

import type { PlanetPhysical } from '../../generation/planets';
import type { RockyTuning } from './planet-surface';
import type { RockySurface } from './rocky-surface';
import type { PlanetSurface, SurfaceBake } from './surface-bake';

import { positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { PLANET_SURFACE_MAP_WIDTH, ROCKY_SURFACE } from '../../config/render';
import { isRockyType, rockyRegime } from './planet-surface';
import { createRockySurface } from './rocky-surface';
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
  /**
   * Show the game's surface for this planet (rocky types today; the flat fill
   * otherwise). Cheap to call every frame: it re-bakes only when the planet's
   * derived inputs change, e.g. when a pooled mesh is reused for another planet.
   */
  setPlanet: (planet: PlanetPhysical, tuning?: RockyTuning) => void;
  /** Install a procedural surface, or `null` to return to the flat fill. */
  setSurface: (surface: PlanetSurface | null, source?: AlbedoSource) => void;
  /** The installed surface, if any. */
  surface: () => PlanetSurface | null;
}

/** One handle per planet mesh; a system holds only a handful of planets. */
export function createPlanetMaterial(): PlanetMaterialHandle {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  let bake: SurfaceBake | null = null;
  let installed: PlanetSurface | null = null;
  let rocky: RockySurface | null = null;
  let regimeKey = '';

  const setSurface = (surface: PlanetSurface | null, source: AlbedoSource = 'baked'): void => {
    bake?.dispose();
    bake = null;
    installed = surface;
    material.colorNode = null;
    material.emissiveNode = null;
    material.normalNode = null;
    if (surface) {
      let sampled;
      if (source === 'baked') {
        bake = createSurfaceBake(surface, PLANET_SURFACE_MAP_WIDTH);
        sampled = bake.node;
        if (surface.relief)
          material.normalNode = bake.reliefNormal(surface.relief);
      }
      else {
        sampled = surface.sample(positionLocal.normalize());
      }
      material.colorNode = sampled.rgb;
      if (surface.emissive)
        material.emissiveNode = surface.emissive(sampled);
    }
    material.needsUpdate = true;
  };

  return {
    material,
    setSurface,
    refreshSurface: () => bake?.invalidate(),
    surface: () => installed,
    dispose: () => {
      bake?.dispose();
      material.dispose();
    },
    setFill: (colorHex) => {
      material.color.set(colorHex);
    },
    setPlanet: (planet, tuning = ROCKY_SURFACE) => {
      if (!isRockyType(planet.type)) {
        if (installed)
          setSurface(null);
        return;
      }
      rocky ??= createRockySurface();
      const regime = rockyRegime(planet, tuning);
      rocky.set(tuning, regime);
      const key = JSON.stringify(regime);
      if (installed !== rocky.surface) {
        setSurface(rocky.surface);
      }
      else if (key !== regimeKey) {
        bake?.invalidate();
      }
      regimeKey = key;
    },
  };
}
