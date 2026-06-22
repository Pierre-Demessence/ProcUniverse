/**
 * Bottom-right HUD panel that reveals a clicked body's seed-derived physics.
 * Everything shown is a one-time function of the seed (`StarPhysical` /
 * `PlanetPhysical` / `OrbitElements`) — never per-frame-varying state — so the
 * DOM is only rebuilt when the selected entity changes, not every frame.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { EntityId } from '@pierre/ecs/entity-id';

import type { PlanetPhysical, PlanetType, WaterState } from '../generation/planets';
import type { SpectralClass, StarPhysical } from '../generation/stars';
import type { PickResult } from '../pick';
import type { OrbitElements } from '../sim/orbits';

import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { OrbitElementsDef } from '../sim/orbits';

export interface Inspector {
  dispose: () => void;
  update: (world: EcsWorld, selection: PickResult | null) => void;
}

/** Three significant figures with thousands separators, trailing zeros dropped. */
export function sigFigs(value: number, digits = 3): string {
  // `maximumSignificantDigits` (not `toPrecision`) so a tiny value like an
  // M-dwarf's ~7e-4 L☉ keeps its figures instead of hitting the default
  // 3-fraction-digit cap and collapsing to "0.001".
  return value.toLocaleString('en-US', { maximumSignificantDigits: digits });
}

/** A measured quantity as `value unit`, e.g. `1.02 M☉`. */
export function formatQuantity(value: number, unit: string): string {
  return `${sigFigs(value)} ${unit}`;
}

/** A temperature rounded to whole kelvin, e.g. `5,772 K`. */
export function formatTemperature(kelvin: number): string {
  return `${Math.round(kelvin).toLocaleString('en-US')} K`;
}

/** A stellar lifetime in the largest fitting unit (Gyr / Myr / kyr / yr). */
export function formatLifetime(years: number): string {
  if (years >= 1e9)
    return `${sigFigs(years / 1e9)} Gyr`;
  if (years >= 1e6)
    return `${sigFigs(years / 1e6)} Myr`;
  if (years >= 1e3)
    return `${sigFigs(years / 1e3)} kyr`;
  return `${sigFigs(years)} yr`;
}

/** A planet type as a display label, e.g. `gas-giant` -> `Gas giant`. */
export function formatPlanetType(type: PlanetType): string {
  const spaced = type.replace('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Habitability as `Yes`/`No` plus the inferred surface-water phase. */
export function formatHabitability(inHabitableZone: boolean, waterState: WaterState): string {
  return `${inHabitableZone ? 'Yes' : 'No'} · ${waterState}`;
}

const PANEL_CSS = [
  'position:absolute',
  'bottom:10px',
  'right:10px',
  'flex-direction:column',
  'gap:4px',
  'padding:8px 10px',
  'min-width:188px',
  'max-width:240px',
  'background:rgba(8,12,24,0.66)',
  'border:1px solid rgba(120,150,210,0.25)',
  'border-radius:6px',
  'color:#cfe3ff',
  'font:12px ui-monospace,monospace',
  'user-select:none',
  'pointer-events:auto',
].join(';');

const CAPTION_CSS = 'font-size:10px; letter-spacing:0.12em; color:rgba(160,190,240,0.6)';
const LABEL_CSS = 'color:rgba(160,190,240,0.7)';
const VALUE_CSS = 'color:#e6f0ff; text-align:right';
const ROW_CSS = 'display:flex; justify-content:space-between; gap:16px';

function labelledRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = ROW_CSS;
  const left = document.createElement('span');
  left.style.cssText = LABEL_CSS;
  left.textContent = label;
  const right = document.createElement('span');
  right.style.cssText = VALUE_CSS;
  right.textContent = value;
  row.append(left, right);
  return row;
}

/** Spectral-class row with a glowing colour swatch matching the star's hue. */
function spectralRow(colorHex: string, spectralClass: SpectralClass): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `${ROW_CSS}; align-items:center`;
  const left = document.createElement('span');
  left.style.cssText = LABEL_CSS;
  left.textContent = 'Class';
  const right = document.createElement('span');
  right.style.cssText = 'display:flex; align-items:center; gap:6px';
  const swatch = document.createElement('span');
  swatch.style.cssText = 'display:inline-block; width:10px; height:10px; border-radius:50%';
  // Assign the seed-derived hue via the style API (not interpolated into
  // cssText) so a colour string can never escape into other declarations.
  swatch.style.background = colorHex;
  swatch.style.boxShadow = `0 0 6px ${colorHex}`;
  const text = document.createElement('span');
  text.style.cssText = VALUE_CSS;
  text.textContent = spectralClass;
  right.append(swatch, text);
  row.append(left, right);
  return row;
}

/**
 * Build the inspector panel and append it to `container` (a positioned
 * ancestor). It starts hidden; `update` shows it for the current selection and
 * `dispose` detaches it.
 */
export function createInspector(container: HTMLElement): Inspector {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_CSS;
  panel.style.display = 'none';

  const caption = document.createElement('div');
  caption.style.cssText = CAPTION_CSS;

  const body = document.createElement('div');
  body.style.cssText = 'display:flex; flex-direction:column; gap:3px';

  panel.append(caption, body);
  container.append(panel);

  let shownId: EntityId | null = null;

  const hide = (): void => {
    panel.style.display = 'none';
    shownId = null;
  };

  const renderStar = (star: StarPhysical): void => {
    caption.textContent = `STAR · CLASS ${star.spectralClass}`;
    body.replaceChildren(
      spectralRow(star.colorHex, star.spectralClass),
      labelledRow('Mass', formatQuantity(star.mass, 'M☉')),
      labelledRow('Luminosity', formatQuantity(star.luminosity, 'L☉')),
      labelledRow('Radius', formatQuantity(star.radius, 'R☉')),
      labelledRow('Temperature', formatTemperature(star.temperature)),
      labelledRow('Lifetime', formatLifetime(star.lifetime)),
    );
  };

  const renderPlanet = (planet: PlanetPhysical, orbit: OrbitElements): void => {
    caption.textContent = `PLANET · ${formatPlanetType(planet.type).toUpperCase()}`;
    body.replaceChildren(
      labelledRow('Mass', formatQuantity(planet.mass, 'M⊕')),
      labelledRow('Radius', formatQuantity(planet.radius, 'R⊕')),
      labelledRow('Density', formatQuantity(planet.density, 'g/cm³')),
      labelledRow('Equilibrium', formatTemperature(planet.equilibriumTemp)),
      labelledRow('Habitable', formatHabitability(planet.inHabitableZone, planet.waterState)),
      labelledRow('Orbit a', formatQuantity(orbit.a, 'AU')),
      labelledRow('Eccentricity', sigFigs(orbit.e)),
    );
  };

  return {
    dispose(): void {
      panel.remove();
    },
    update(world: EcsWorld, selection: PickResult | null): void {
      if (!selection) {
        if (shownId !== null)
          hide();
        return;
      }
      if (selection.id === shownId)
        return;

      if (selection.kind === 'star') {
        const star = world.getStore(StarPhysicalDef).get(selection.id);
        if (!star) {
          hide();
          return;
        }
        renderStar(star);
      }
      else {
        const planet = world.getStore(PlanetPhysicalDef).get(selection.id);
        const orbit = world.getStore(OrbitElementsDef).get(selection.id);
        if (!planet || !orbit) {
          hide();
          return;
        }
        renderPlanet(planet, orbit);
      }

      panel.style.display = 'flex';
      shownId = selection.id;
    },
  };
}
