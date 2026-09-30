/**
 * Shared lit planet material (docs/plans/planet-surfaces.md §3). Planets stay
 * lit by the star's point light — only the albedo (plus relief and any thermal
 * glow) changes — so the day/night terminator keeps working. Moons use the
 * same material with a moon surface. Planet types without a surface slice yet
 * keep the flat fill.
 */

import type { MoonPhysical } from '../../generation/moons';
import type { PlanetPhysical } from '../../generation/planets';
import type { MoonTuning, RockyRegime, RockyTuning } from './planet-surface';
import type { RockySurface } from './rocky-surface';
import type { PlanetSurface, SurfaceBake } from './surface-bake';

import { positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { MOON_SURFACE, PLANET_SURFACE_MAP_WIDTH, ROCKY_SURFACE } from '../../config/render';
import { isRockyType, moonSurface, rockyRegime } from './planet-surface';
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
  /** Show a moon's surface: an airless body at its host planet's temperature `hostTempK`. */
  setMoon: (moon: MoonPhysical, hostTempK: number, rocky?: RockyTuning, tuning?: MoonTuning) => void;
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

/**
 * One handle per planet or moon mesh. `mapWidth` sizes the baked surface map
 * (smaller for moons, which are many and small on screen).
 */
export function createPlanetMaterial(mapWidth = PLANET_SURFACE_MAP_WIDTH): PlanetMaterialHandle {
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
        bake = createSurfaceBake(surface, mapWidth);
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

  /**
   * Install the rocky surface with these inputs. Cheap every frame: it re-bakes
   * only when the derived inputs change (e.g. a pooled mesh reused for another body).
   */
  const showRocky = (tuning: RockyTuning, regime: RockyRegime): void => {
    rocky ??= createRockySurface();
    rocky.set(tuning, regime);
    const key = JSON.stringify(regime);
    if (installed !== rocky.surface)
      setSurface(rocky.surface);
    else if (key !== regimeKey)
      bake?.invalidate();
    regimeKey = key;
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
    setMoon: (moon, hostTempK, rockyTuning = ROCKY_SURFACE, tuning = MOON_SURFACE) => {
      const inputs = moonSurface(moon, hostTempK, rockyTuning, tuning);
      showRocky(inputs.tuning, inputs.regime);
    },
    setPlanet: (planet, tuning = ROCKY_SURFACE) => {
      if (isRockyType(planet.type))
        showRocky(tuning, rockyRegime(planet, tuning));
      else if (installed)
        setSurface(null);
    },
  };
}
