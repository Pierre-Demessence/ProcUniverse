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

import type { BlackHolePhysical, GalaxyParams, GalaxyType } from '../generation/galaxies';
import type { PlanetPhysical, PlanetType, WaterState } from '../generation/planets';
import type { StarPhysical } from '../generation/stars';
import type { Selection } from '../pick';
import type { OrbitElements } from '../sim/orbits';

import { signal } from '@preact/signals';
import { render } from 'preact';

import { BlackHoleDef, eddingtonLuminosity, environmentClass, estimatedStarCount, evaporationTime, galaxyDiameterLy, galaxyRepresentativeActivity, hawkingTemperature, innermostStableOrbit, photonSphere, shadowDiameter, velocityDispersion } from '../generation/galaxies';
import { NameDef } from '../generation/naming';
import { centralPressure, compositionClass, earthSimilarityIndex, escapeVelocity, frostLine, habitableZone, PlanetPhysicalDef, surfaceGravity } from '../generation/planets';
import { bolometricMagnitude, meanDensity, peakWavelength, escapeVelocity as starEscapeVelocity, StarPhysicalDef, surfaceGravityLog } from '../generation/stars';
import { SECONDS_PER_YEAR } from '../generation/units';
import { populationColorCss } from '../render/galaxy-sprites';
import { apoapsis, insolationSwing, meanOrbitalSpeed, orbitalPeriod, OrbitElementsDef, periapsis } from '../sim/orbits';

export interface Inspector {
  dispose: () => void;
  update: (world: EcsWorld, selection: Selection | null) => void;
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

/** A large count in the largest fitting unit (billion / million / thousand). */
export function formatCount(value: number): string {
  if (value >= 1e9)
    return `${sigFigs(value / 1e9)} billion`;
  if (value >= 1e6)
    return `${sigFigs(value / 1e6)} million`;
  if (value >= 1e3)
    return `${sigFigs(value / 1e3)} thousand`;
  return sigFigs(value);
}

/** A planet type as a display label, e.g. `gas-giant` -> `Gas giant`. */
export function formatPlanetType(type: PlanetType): string {
  const spaced = type.replace('-', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A galaxy morphology label, e.g. a dwarf `barred-spiral` -> `Dwarf barred spiral`. */
export function formatGalaxyType(type: GalaxyType, dwarf: boolean): string {
  const spaced = type.replace('-', ' ');
  return dwarf ? `Dwarf ${spaced}` : spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
  const hz = habitableZone(star.luminosity);
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
        <Row label="Density" value={formatQuantity(meanDensity(star.mass, star.radius), 'g/cm³')} />
        <Row label="Gravity (log g)" value={sigFigs(surfaceGravityLog(star.mass, star.radius))} />
        <Row label="Escape vel." value={formatQuantity(starEscapeVelocity(star.mass, star.radius), 'km/s')} />
        <TemperatureRow label="Temperature" kelvin={star.temperature} />
        <Row label="Peak λ" value={formatQuantity(peakWavelength(star.temperature), 'nm')} />
        <Row label="Bolo. mag" value={sigFigs(bolometricMagnitude(star.luminosity))} />
        <Row label="Lifetime" value={formatLifetime(star.lifetime)} />
        <Row label="Habitable zone" value={`${sigFigs(hz.inner)}–${sigFigs(hz.outer)} AU`} />
        <Row label="Frost line" value={formatQuantity(frostLine(star.luminosity), 'AU')} />
      </div>
    </div>
  );
}

function PlanetPanel({ name, orbit, planet }: { name: string; orbit: OrbitElements; planet: PlanetPhysical }): VNode {
  const escape = escapeVelocity(planet.mass, planet.radius);
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>{`PLANET · ${formatPlanetType(planet.type).toUpperCase()}`}</div>
      <div style={BODY_CSS}>
        <Row label="Mass" value={formatQuantity(planet.mass, 'M⊕')} />
        <Row label="Radius" value={formatQuantity(planet.radius, 'R⊕')} />
        <Row label="Density" value={formatQuantity(planet.density, 'g/cm³')} />
        <Row label="Gravity" value={formatQuantity(surfaceGravity(planet.mass, planet.radius), 'g⊕')} />
        <Row label="Escape vel." value={formatQuantity(escape, 'km/s')} />
        <Row label="Composition" value={compositionClass(planet.type, planet.density)} />
        <Row label="Core press." value={`~${formatQuantity(centralPressure(planet.mass, planet.radius), 'GPa')}`} />
        <TemperatureRow label="Equilibrium" kelvin={planet.equilibriumTemp} />
        <Row label="Insolation" value={formatQuantity(planet.insolation, 'S⊕')} />
        <Row label="Habitable" value={formatHabitability(planet.inHabitableZone, planet.waterState)} />
        <Row label="Earth index" value={sigFigs(earthSimilarityIndex(planet.radius, planet.density, escape, planet.equilibriumTemp))} />
        <Row label="Orbit a" value={formatQuantity(orbit.a, 'AU')} />
        <Row label="Peri / Apo" value={`${sigFigs(periapsis(orbit))} / ${sigFigs(apoapsis(orbit))} AU`} />
        <Row label="Period" value={formatPeriod(orbitalPeriod(orbit.starMass, orbit.a))} />
        <Row label="Orbital speed" value={formatQuantity(meanOrbitalSpeed(orbit), 'km/s')} />
        <Row label="Eccentricity" value={sigFigs(orbit.e)} />
        <Row label="Flux swing" value={`${sigFigs(insolationSwing(orbit))}×`} />
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
        <Row label="Photon sphere" value={formatQuantity(photonSphere(blackHole.schwarzschildRadius), 'AU')} />
        <Row label="ISCO" value={formatQuantity(innermostStableOrbit(blackHole.schwarzschildRadius), 'AU')} />
        <Row label="Shadow Ø" value={formatQuantity(shadowDiameter(blackHole.schwarzschildRadius), 'AU')} />
        <Row label="Eddington L" value={`${formatCount(eddingtonLuminosity(blackHole.mass))} L☉`} />
        <Row label="Hawking T" value={`${hawkingTemperature(blackHole.mass).toExponential(1)} K`} />
        <Row label="Evaporation" value={`${evaporationTime(blackHole.mass).toExponential(1)} yr`} />
      </div>
    </div>
  );
}

function GalaxyPanel({ galaxy }: { galaxy: GalaxyParams }): VNode {
  const swatch = populationColorCss(galaxyRepresentativeActivity(galaxy));
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{galaxy.name}</div>
      <div style={`${CAPTION_CSS}; display:flex; align-items:center; gap:6px`}>
        <span
          style={{
            background: swatch,
            borderRadius: '50%',
            boxShadow: `0 0 6px ${swatch}`,
            display: 'inline-block',
            height: '8px',
            width: '8px',
          }}
        />
        <span>{`GALAXY · ${formatGalaxyType(galaxy.type, galaxy.dwarf).toUpperCase()}`}</span>
      </div>
      <div style={BODY_CSS}>
        <Row label="Diameter" value={`${sigFigs(galaxyDiameterLy(galaxy))} ly`} />
        <Row label="Stars" value={`~${formatCount(estimatedStarCount(galaxy))}`} />
        <Row label="Dispersion σ" value={formatQuantity(velocityDispersion(galaxy.blackHoleMass), 'km/s')} />
        <Row label="Environment" value={environmentClass(galaxy.cosmicDensity)} />
        <Row label="Black hole" value={formatSolarMasses(galaxy.blackHoleMass)} />
      </div>
    </div>
  );
}

interface InspectorPanelProps {
  selection: Signal<Selection | null>;
  getWorld: () => EcsWorld | null;
}

function InspectorPanel({ getWorld, selection }: InspectorPanelProps): VNode | null {
  const sel = selection.value;
  if (!sel)
    return null;

  if (sel.kind === 'galaxy')
    return <GalaxyPanel galaxy={sel.galaxy} />;

  const world = getWorld();
  if (!world)
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
  const selection = signal<Selection | null>(null);
  let world: EcsWorld | null = null;

  const mount = document.createElement('div');
  container.append(mount);
  render(<InspectorPanel getWorld={() => world} selection={selection} />, mount);

  return {
    dispose(): void {
      render(null, mount);
      mount.remove();
    },
    update(nextWorld: EcsWorld, nextSelection: Selection | null): void {
      world = nextWorld;
      // Called every frame: the render loop holds a stable selection reference
      // between picks, so this assignment is an Object.is no-op until the
      // selection actually changes, and the panel re-renders only then.
      selection.value = nextSelection;
    },
  };
}
