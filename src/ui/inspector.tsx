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
import type { TemperatureUnit } from '../settings';
import type { OrbitElements } from '../sim/orbits';

import { signal } from '@preact/signals';
import { render } from 'preact';
import { useState } from 'preact/hooks';

import { formatDistance } from '../distance';
import { BlackHoleDef, eddingtonLuminosity, environmentClass, estimatedStarCount, evaporationTime, galaxyAt, galaxyDiameterLy, galaxyRepresentativeActivity, gasFraction, hawkingTemperature, innermostStableOrbit, isActiveGalacticNucleus, meanStellarAge, photonSphere, shadowDiameter, starFormationRate, universeAge, velocityDispersion } from '../generation/galaxies';
import { NameDef } from '../generation/naming';
import { atmosphereType, centralPressure, compositionClass, earthSimilarityIndex, escapeVelocity, frostLine, habitableZone, oblateness, PlanetPhysicalDef, retainsAtmosphere, surfaceGravity, surfaceTemperature } from '../generation/planets';
import { bolometricMagnitude, meanDensity, peakWavelength, escapeVelocity as starEscapeVelocity, StarPhysicalDef, surfaceGravityLog } from '../generation/stars';
import { AU_PER_LY, SECONDS_PER_YEAR } from '../generation/units';
import { populationColorCss } from '../render/galaxy-sprites';
import { distanceUnit, temperatureUnit } from '../settings';
import { apoapsis, insolationSwing, meanOrbitalSpeed, orbitalPeriod, OrbitElementsDef, periapsis } from '../sim/orbits';

export interface Inspector {
  dispose: () => void;
  update: (world: EcsWorld, selection: Selection | null) => void;
}

// Kelvin offset of the Celsius zero point (0 °C = 273.15 K).
const CELSIUS_OFFSET = 273.15;

// Convenient-unit thresholds for an orbital period, in seconds.
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

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
  if (unit === 'F')
    return `${Math.round((kelvin - CELSIUS_OFFSET) * 9 / 5 + 32).toLocaleString('en-US')} °F`;
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

/** A world seed as an 8-digit uppercase hex identity, e.g. `0x0F3A19C4`. */
export function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
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

// A help popover anchored to the LEFT of its row (the panel is pinned
// bottom-right with no clipping, so it stays on-screen) and a touch more opaque
// than the panel so the wrapped text stays legible over the scene behind it.
const TOOLTIP_CSS = [
  'position:absolute',
  'right:calc(100% + 10px)',
  'top:50%',
  'transform:translateY(-50%)',
  'width:190px',
  'padding:6px 9px',
  'background:rgba(10,14,28,0.96)',
  'border:1px solid rgba(120,150,210,0.35)',
  'border-radius:6px',
  'color:#dce8ff',
  'font:11px ui-monospace,monospace',
  'line-height:1.45',
  'text-align:left',
  'white-space:normal',
  'box-shadow:0 4px 14px rgba(0,0,0,0.5)',
  'pointer-events:none',
  'z-index:5',
].join(';');

/** Track pointer hover for a row; bind the handlers to the row element. */
function useHover(): { hovered: boolean; onMouseEnter: () => void; onMouseLeave: () => void } {
  const [hovered, setHovered] = useState(false);
  return { hovered, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };
}

/** A label/value row that reveals a one-sentence help popover on hover. */
function Row({ label, tooltip, value }: { label: string; tooltip: string; value: string }): VNode {
  const hover = useHover();
  return (
    <div style={`${ROW_CSS}; position:relative; cursor:help`} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <span style={LABEL_CSS}>{label}</span>
      <span style={VALUE_CSS}>{value}</span>
      {hover.hovered && <span style={TOOLTIP_CSS}>{tooltip}</span>}
    </div>
  );
}

/**
 * A temperature row whose value reads the live `temperatureUnit` signal, so it
 * re-renders in the chosen unit whenever the options menu changes it.
 */
function TemperatureRow({ kelvin, label, tooltip }: { kelvin: number; label: string; tooltip: string }): VNode {
  const hover = useHover();
  return (
    <div style={`${ROW_CSS}; position:relative; cursor:help`} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <span style={LABEL_CSS}>{label}</span>
      <span style={VALUE_CSS}>{formatTemperature(kelvin, temperatureUnit.value)}</span>
      {hover.hovered && <span style={TOOLTIP_CSS}>{tooltip}</span>}
    </div>
  );
}

/** The star's spectral-class row: colour swatch, class letter, and a help popover. */
function ClassRow({ star }: { star: StarPhysical }): VNode {
  const hover = useHover();
  return (
    <div style={`${ROW_CSS}; align-items:center; position:relative; cursor:help`} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
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
      {hover.hovered && <span style={TOOLTIP_CSS}>{'The star\'s spectral class — a letter (O B A F G K M) from hottest blue to coolest red.'}</span>}
    </div>
  );
}

function StarPanel({ name, star }: { name: string; star: StarPhysical }): VNode {
  const hz = habitableZone(star.luminosity);
  const du = distanceUnit.value;
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>{`STAR · CLASS ${star.spectralClass}`}</div>
      <div style={BODY_CSS}>
        <ClassRow star={star} />
        <Row label="Mass" value={formatQuantity(star.mass, 'M☉')} tooltip="How much matter the star contains, in multiples of the Sun's mass." />
        <Row label="Luminosity" value={formatQuantity(star.luminosity, 'L☉')} tooltip="Total light the star radiates, relative to the Sun." />
        <Row label="Radius" value={formatQuantity(star.radius, 'R☉')} tooltip="The star's size, in multiples of the Sun's radius." />
        <Row label="Density" value={formatQuantity(meanDensity(star.mass, star.radius), 'g/cm³')} tooltip="Average mass packed into each cubic centimetre of the star." />
        <Row label="Gravity (log g)" value={sigFigs(surfaceGravityLog(star.mass, star.radius))} tooltip="Surface gravity on a logarithmic scale; the Sun is about 4.44." />
        <Row label="Escape vel." value={formatQuantity(starEscapeVelocity(star.mass, star.radius), 'km/s')} tooltip="Speed needed to escape the star's gravity from its surface." />
        <TemperatureRow label="Temperature" kelvin={star.temperature} tooltip="The star's surface temperature." />
        <Row label="Peak λ" value={formatQuantity(peakWavelength(star.temperature), 'nm')} tooltip="The wavelength of light the star glows most strongly at." />
        <Row label="Bolo. mag" value={sigFigs(bolometricMagnitude(star.luminosity))} tooltip="Overall brightness on the magnitude scale — smaller numbers are brighter." />
        <Row label="Metallicity" value={`${sigFigs(star.metallicity)} dex`} tooltip="Richness in elements heavier than hydrogen and helium; 0 ≈ the Sun." />
        <Row label="Lifetime" value={formatLifetime(star.lifetime)} tooltip="How long the star can shine before exhausting its core hydrogen." />
        <Row label="Age" value={formatLifetime(star.age)} tooltip="How long the star has existed so far." />
        <Row label="MS elapsed" value={`${Math.round((100 * star.age) / star.lifetime)}%`} tooltip="Fraction of its hydrogen-burning life the star has already used." />
        <Row label="Habitable zone" value={`${formatDistance(hz.inner, du)} – ${formatDistance(hz.outer, du)}`} tooltip="Distance range where a planet could have liquid surface water." />
        <Row label="Frost line" value={formatDistance(frostLine(star.luminosity), du)} tooltip="Distance beyond which it's cold enough for ice — where giant planets tend to form." />
      </div>
    </div>
  );
}

function PlanetPanel({ name, orbit, planet }: { name: string; orbit: OrbitElements; planet: PlanetPhysical }): VNode {
  const escape = escapeVelocity(planet.mass, planet.radius);
  const hasAtmosphere = retainsAtmosphere(escape, planet.insolation);
  const du = distanceUnit.value;
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>{`PLANET · ${formatPlanetType(planet.type).toUpperCase()}`}</div>
      <div style={BODY_CSS}>
        <Row label="Mass" value={formatQuantity(planet.mass, 'M⊕')} tooltip="How much matter the planet contains, in multiples of Earth's mass." />
        <Row label="Radius" value={formatQuantity(planet.radius, 'R⊕')} tooltip="The planet's size, in multiples of Earth's radius." />
        <Row label="Density" value={formatQuantity(planet.density, 'g/cm³')} tooltip="Average mass per cubic centimetre, hinting at rock, ice, or gas." />
        <Row label="Gravity" value={formatQuantity(surfaceGravity(planet.mass, planet.radius), 'g⊕')} tooltip="Surface gravity in multiples of Earth's; 1 means you'd weigh the same." />
        <Row label="Escape vel." value={formatQuantity(escape, 'km/s')} tooltip="Speed needed to escape the planet's gravity from its surface." />
        <Row label="Composition" value={compositionClass(planet.type, planet.density)} tooltip="What the planet is mostly made of, inferred from its density." />
        <Row label="Core press." value={`~${formatQuantity(centralPressure(planet.mass, planet.radius), 'GPa')}`} tooltip="Estimated pressure at the planet's centre, in gigapascals." />
        <Row label="Rotation" value={`${formatPeriod((planet.rotationPeriod * 3600) / SECONDS_PER_YEAR)}${planet.tidallyLocked ? ' · locked' : ''}`} tooltip="Length of one spin (its day); 'locked' means one face always faces the star." />
        <Row label="Oblateness" value={`${sigFigs(oblateness(planet.rotationPeriod, planet.mass, planet.radius) * 100)}%`} tooltip="How much spinning squashes the planet at its equator (Earth ≈ 0.3%)." />
        <Row label="Axial tilt" value={`${Math.round(planet.obliquity)}°`} tooltip="Tilt of the spin axis, which gives a planet its seasons." />
        <Row label="Moons" value={`${planet.moonCount}${planet.hasRings ? ' · rings' : ''}`} tooltip="How many moons orbit the planet, and whether it has rings." />
        <TemperatureRow label="Equilibrium" kelvin={planet.equilibriumTemp} tooltip="Temperature from starlight alone, before any greenhouse warming." />
        <TemperatureRow label="Surface" kelvin={surfaceTemperature(planet.equilibriumTemp, planet.type, hasAtmosphere)} tooltip="Estimated surface temperature including greenhouse warming." />
        <Row label="Insolation" value={formatQuantity(planet.insolation, 'S⊕')} tooltip="How much starlight the planet receives, relative to Earth." />
        <Row label="Atmosphere" value={atmosphereType(planet.type, hasAtmosphere, planet.equilibriumTemp)} tooltip="The kind of atmosphere the planet can likely keep, if any." />
        <Row label="Habitable" value={formatHabitability(planet.inHabitableZone, planet.waterState)} tooltip="Whether it lies in the liquid-water zone, and what state its water is in." />
        <Row label="Earth index" value={sigFigs(earthSimilarityIndex(planet.radius, planet.density, escape, planet.equilibriumTemp))} tooltip="How Earth-like the planet is overall, from 0 to 1 (1 = just like Earth)." />
        <Row label="Orbit a" value={formatDistance(orbit.a, du)} tooltip="Average distance from its star (the orbit's semi-major axis)." />
        <Row label="Peri / Apo" value={`${formatDistance(periapsis(orbit), du)} / ${formatDistance(apoapsis(orbit), du)}`} tooltip="Closest and farthest distance from the star along the orbit." />
        <Row label="Period" value={formatPeriod(orbitalPeriod(orbit.starMass, orbit.a))} tooltip="How long the planet takes to circle its star once — its year." />
        <Row label="Orbital speed" value={formatQuantity(meanOrbitalSpeed(orbit), 'km/s')} tooltip="Average speed the planet moves along its orbit." />
        <Row label="Eccentricity" value={sigFigs(orbit.e)} tooltip="How stretched the orbit is: 0 is a circle, nearer 1 is more elongated." />
        <Row label="Flux swing" value={`${sigFigs(insolationSwing(orbit))}×`} tooltip="How much the starlight varies between the planet's closest and farthest points." />
      </div>
    </div>
  );
}

function BlackHolePanel({ name, blackHole }: { blackHole: BlackHolePhysical; name: string }): VNode {
  const du = distanceUnit.value;
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>{name}</div>
      <div style={CAPTION_CSS}>BLACK HOLE · SUPERMASSIVE</div>
      <div style={BODY_CSS}>
        <Row label="Mass" value={formatSolarMasses(blackHole.mass)} tooltip="Total mass of the black hole, in multiples of the Sun's mass." />
        <Row label="Spin a*" value={sigFigs(blackHole.spin)} tooltip="How fast it spins, from 0 (still) to 1 (the maximum possible)." />
        <Row label="Schwarzschild r" value={formatDistance(blackHole.schwarzschildRadius, du)} tooltip="Radius of the event horizon — the point of no return." />
        <Row label="Photon sphere" value={formatDistance(photonSphere(blackHole.schwarzschildRadius), du)} tooltip="Distance where gravity can bend light into a circular orbit." />
        <Row label="ISCO" value={formatDistance(innermostStableOrbit(blackHole.schwarzschildRadius, blackHole.spin), du)} tooltip="Closest orbit matter can hold before spiralling in — the disc's inner edge." />
        <Row label="Shadow Ø" value={formatDistance(shadowDiameter(blackHole.schwarzschildRadius), du)} tooltip="Apparent width of the black hole's dark silhouette." />
        <Row label="Eddington L" value={`${formatCount(eddingtonLuminosity(blackHole.mass))} L☉`} tooltip="Brightness limit above which radiation blows infalling matter away." />
        <Row label="Accretion" value={`${blackHole.eddingtonRatio.toExponential(1)} L_Edd${isActiveGalacticNucleus(blackHole.eddingtonRatio) ? ' (AGN)' : ''}`} tooltip="How fast it's feeding, versus that limit; 'AGN' marks an active, bright one." />
        <Row label="Hawking T" value={`${hawkingTemperature(blackHole.mass).toExponential(1)} K`} tooltip="The faint temperature it radiates through quantum effects." />
        <Row label="Evaporation" value={`${evaporationTime(blackHole.mass).toExponential(1)} yr`} tooltip="How long it would take to slowly evaporate away entirely." />
      </div>
    </div>
  );
}

function UniversePanel({ seed }: { seed: number }): VNode {
  const home = galaxyAt(seed, 0, 0);
  return (
    <div style={PANEL_CSS}>
      <div style={NAME_CSS}>Universe</div>
      <div style={CAPTION_CSS}>UNIVERSE</div>
      <div style={BODY_CSS}>
        <Row label="Seed" value={formatSeed(seed)} tooltip="The number this whole universe is generated from; the same seed rebuilds it." />
        <Row label="Age" value={formatLifetime(universeAge(seed))} tooltip="How long ago this universe began." />
        <Row label="Home galaxy" value={home ? home.name : '\u2014'} tooltip="The galaxy at the origin, where you started out." />
      </div>
    </div>
  );
}

function GalaxyPanel({ galaxy }: { galaxy: GalaxyParams }): VNode {
  const swatch = populationColorCss(galaxyRepresentativeActivity(galaxy));
  const du = distanceUnit.value;
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
        <Row label="Diameter" value={formatDistance(galaxyDiameterLy(galaxy) * AU_PER_LY, du)} tooltip="How wide the galaxy is from edge to edge." />
        <Row label="Stars" value={`~${formatCount(estimatedStarCount(galaxy))}`} tooltip="Rough estimate of how many stars the galaxy holds." />
        <Row label="SFR" value={`${sigFigs(starFormationRate(galaxy))} M☉/yr`} tooltip="Star-formation rate — Suns' worth of new stars formed per year." />
        <Row label="Mean age" value={`${meanStellarAge(galaxy)} Gyr`} tooltip="Average age of the galaxy's stars." />
        <Row label="Gas fraction" value={`${Math.round(gasFraction(galaxy) * 100)}%`} tooltip="Share of the galaxy's mass still in gas available to form stars." />
        <Row label="Dispersion σ" value={formatQuantity(velocityDispersion(galaxy.blackHoleMass), 'km/s')} tooltip="Spread of star speeds — a gauge of the galaxy's mass." />
        <Row label="Environment" value={environmentClass(galaxy.cosmicDensity)} tooltip="How crowded its surroundings are, from empty void to dense cluster." />
        <Row label="Black hole" value={formatSolarMasses(galaxy.blackHoleMass)} tooltip="Mass of the supermassive black hole at the galaxy's core." />
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

  if (sel.kind === 'universe')
    return <UniversePanel seed={sel.seed} />;

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
