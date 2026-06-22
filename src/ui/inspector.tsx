/**
 * Bottom-right HUD panel that reveals a clicked body's seed-derived physics.
 * Everything shown is a one-time function of the seed (`StarPhysical` /
 * `PlanetPhysical` / `OrbitElements`) — never per-frame-varying state.
 *
 * Built with Preact + signals: the render loop writes the current selection
 * into a signal each frame, but the same object reference between picks dedupes,
 * so the panel only re-renders when the selection actually changes.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { Signal } from '@preact/signals';
import type { VNode } from 'preact';

import type { BlackHolePhysical } from '../generation/galaxies';
import type { PlanetPhysical, PlanetType, WaterState } from '../generation/planets';
import type { StarPhysical } from '../generation/stars';
import type { PickResult } from '../pick';
import type { OrbitElements } from '../sim/orbits';

import { signal } from '@preact/signals';
import { render } from 'preact';

import { BlackHoleDef } from '../generation/galaxies';
import { NameDef } from '../generation/naming';
import { PlanetPhysicalDef } from '../generation/planets';
import { StarPhysicalDef } from '../generation/stars';
import { SECONDS_PER_YEAR } from '../generation/units';
import { orbitalPeriod, OrbitElementsDef } from '../sim/orbits';

export interface Inspector {
  dispose: () => void;
  update: (world: EcsWorld, selection: PickResult | null) => void;
}

/** Display unit for temperatures: absolute kelvin or degrees Celsius. */
export type TemperatureUnit = 'C' | 'K';

// Kelvin offset of the Celsius zero point (0 °C = 273.15 K).
const CELSIUS_OFFSET = 273.15;

// Convenient-unit thresholds for an orbital period, in seconds.
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/**
 * The temperature unit the inspector renders, toggled live from the panel. A
 * signal so reading it inside a component subscribes that component, re-rendering
 * just the temperature rows when the unit flips — independent of the selection.
 */
export const temperatureUnit = signal<TemperatureUnit>('K');

/** Flip the inspector's temperature unit between kelvin and Celsius. */
export function toggleTemperatureUnit(): void {
  temperatureUnit.value = temperatureUnit.value === 'K' ? 'C' : 'K';
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

/** A temperature in the chosen unit, rounded to a whole degree, e.g. `5,772 K`. */
export function formatTemperature(kelvin: number, unit: TemperatureUnit = 'K'): string {
  if (unit === 'C')
    return `${Math.round(kelvin - CELSIUS_OFFSET).toLocaleString('en-US')} °C`;
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

/**
 * An orbital period (given in years) in the largest unit that keeps the number
 * human-readable: seconds, then minutes (≥60 s), hours (≥60 min), days (≥24 h),
 * and finally years (≥1 yr).
 */
export function formatPeriod(years: number): string {
  const seconds = years * SECONDS_PER_YEAR;
  if (seconds < SECONDS_PER_MINUTE)
    return `${sigFigs(seconds)} s`;
  if (seconds < SECONDS_PER_HOUR)
    return `${sigFigs(seconds / SECONDS_PER_MINUTE)} min`;
  if (seconds < SECONDS_PER_DAY)
    return `${sigFigs(seconds / SECONDS_PER_HOUR)} h`;
  if (seconds < SECONDS_PER_YEAR)
    return `${sigFigs(seconds / SECONDS_PER_DAY)} days`;
  return `${sigFigs(years)} yr`;
}

/** A supermassive mass in the largest fitting unit (billion / million M☉). */
export function formatSolarMasses(massSolar: number): string {
  if (massSolar >= 1e9)
    return `${sigFigs(massSolar / 1e9)} billion M☉`;
  if (massSolar >= 1e6)
    return `${sigFigs(massSolar / 1e6)} million M☉`;
  return formatQuantity(massSolar, 'M☉');
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
  'display:flex',
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
const NAME_CSS = 'font-size:13px; font-weight:600; letter-spacing:0.03em; color:#eaf2ff';
const BODY_CSS = 'display:flex; flex-direction:column; gap:3px';
const ROW_CSS = 'display:flex; justify-content:space-between; gap:16px';
const LABEL_CSS = 'color:rgba(160,190,240,0.7)';
const VALUE_CSS = 'color:#e6f0ff; text-align:right';

function Row({ label, value }: { label: string; value: string }): VNode {
  return (
    <div style={ROW_CSS}>
      <span style={LABEL_CSS}>{label}</span>
      <span style={VALUE_CSS}>{value}</span>
    </div>
  );
}

/**
 * A temperature row whose value reads the live `temperatureUnit` signal and
 * toggles it on click, so K ⇄ °C switches every temperature in the panel at once.
 */
function TemperatureRow({ kelvin, label }: { kelvin: number; label: string }): VNode {
  return (
    <div
      style={`${ROW_CSS}; cursor:pointer`}
      title="Click to switch between K and °C"
      onClick={toggleTemperatureUnit}
    >
      <span style={LABEL_CSS}>{label}</span>
      <span style={VALUE_CSS}>{formatTemperature(kelvin, temperatureUnit.value)}</span>
    </div>
  );
}

function StarPanel({ name, star }: { name: string; star: StarPhysical }): VNode {
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>{`STAR · CLASS ${star.spectralClass}`}</div>
      <div style={BODY_CSS}>
        <div style={`${ROW_CSS}; align-items:center`}>
          <span style={LABEL_CSS}>Class</span>
          <span style="display:flex; align-items:center; gap:6px">
            {/* Object style (not interpolated cssText) so a colour string is a
                single property value and can never escape into other rules. */}
            <span
              style={{
                background: star.colorHex,
                borderRadius: '50%',
                boxShadow: `0 0 6px ${star.colorHex}`,
                display: 'inline-block',
                height: '10px',
                width: '10px',
              }}
            />
            <span style={VALUE_CSS}>{star.spectralClass}</span>
          </span>
        </div>
        <Row label="Mass" value={formatQuantity(star.mass, 'M☉')} />
        <Row label="Luminosity" value={formatQuantity(star.luminosity, 'L☉')} />
        <Row label="Radius" value={formatQuantity(star.radius, 'R☉')} />
        <TemperatureRow label="Temperature" kelvin={star.temperature} />
        <Row label="Lifetime" value={formatLifetime(star.lifetime)} />
      </div>
    </div>
  );
}

function PlanetPanel({ name, orbit, planet }: { name: string; orbit: OrbitElements; planet: PlanetPhysical }): VNode {
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>{`PLANET · ${formatPlanetType(planet.type).toUpperCase()}`}</div>
      <div style={BODY_CSS}>
        <Row label="Mass" value={formatQuantity(planet.mass, 'M⊕')} />
        <Row label="Radius" value={formatQuantity(planet.radius, 'R⊕')} />
        <Row label="Density" value={formatQuantity(planet.density, 'g/cm³')} />
        <TemperatureRow label="Equilibrium" kelvin={planet.equilibriumTemp} />
        <Row label="Habitable" value={formatHabitability(planet.inHabitableZone, planet.waterState)} />
        <Row label="Orbit a" value={formatQuantity(orbit.a, 'AU')} />
        <Row label="Period" value={formatPeriod(orbitalPeriod(orbit.starMass, orbit.a))} />
        <Row label="Eccentricity" value={sigFigs(orbit.e)} />
      </div>
    </div>
  );
}

function BlackHolePanel({ name, blackHole }: { blackHole: BlackHolePhysical; name: string }): VNode {
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>BLACK HOLE · SUPERMASSIVE</div>
      <div style={BODY_CSS}>
        <Row label="Mass" value={formatSolarMasses(blackHole.mass)} />
        <Row label="Schwarzschild r" value={formatQuantity(blackHole.schwarzschildRadius, 'AU')} />
      </div>
    </div>
  );
}

interface InspectorPanelProps {
  selection: Signal<PickResult | null>;
  getWorld: () => EcsWorld | null;
}

function InspectorPanel({ getWorld, selection }: InspectorPanelProps): VNode | null {
  const sel = selection.value;
  const world = getWorld();
  if (!sel || !world)
    return null;

  if (sel.kind === 'star') {
    const star = world.getStore(StarPhysicalDef).get(sel.id);
    const identity = world.getStore(NameDef).get(sel.id);
    return star ? <StarPanel name={identity?.name ?? ''} star={star} /> : null;
  }

  if (sel.kind === 'black-hole') {
    const blackHole = world.getStore(BlackHoleDef).get(sel.id);
    const identity = world.getStore(NameDef).get(sel.id);
    return blackHole ? <BlackHolePanel blackHole={blackHole} name={identity?.name ?? ''} /> : null;
  }

  const planet = world.getStore(PlanetPhysicalDef).get(sel.id);
  const orbit = world.getStore(OrbitElementsDef).get(sel.id);
  const identity = world.getStore(NameDef).get(sel.id);
  return planet && orbit ? <PlanetPanel name={identity?.name ?? ''} orbit={orbit} planet={planet} /> : null;
}

/**
 * Build the inspector panel and append it to `container` (a positioned
 * ancestor). It renders nothing until `update` is given a non-null selection;
 * `dispose` unmounts and detaches it.
 */
export function createInspector(container: HTMLElement): Inspector {
  const selection = signal<PickResult | null>(null);
  let world: EcsWorld | null = null;

  const mount = document.createElement('div');
  container.append(mount);
  render(<InspectorPanel getWorld={() => world} selection={selection} />, mount);

  return {
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
    update(nextWorld: EcsWorld, nextSelection: PickResult | null): void {
      world = nextWorld;
      // Called every frame: the render loop holds a stable selection reference
      // between picks, so this assignment is an Object.is no-op until the
      // selection actually changes, and the panel re-renders only then.
      selection.value = nextSelection;
    },
  };
}
