/**
 * System-tier body management: one engine `Scene3DRenderer` pass per kind of
 * mesh. The passes own which meshes exist (created on first selection, removed
 * when the entity streams out); the free-lists below recycle the meshes and
 * their GPU materials, which the engine deliberately leaves to the caller.
 */

import type { EcsWorld } from '@pierre/ecs';
import type { ComponentDef } from '@pierre/ecs/component-store';
import type { EntityId } from '@pierre/ecs/entity-id';
import type { Scene3DEntry, SceneGraph } from '@pierre/ecs/modules/render-scene3d';
import type { Group, Mesh, MeshStandardMaterial, PointLight } from 'three/webgpu';

import type { BlackHolePhysical } from '../../generation/galaxies';
import type { MoonPhysical } from '../../generation/moons';
import type { PlanetPhysical } from '../../generation/planets';
import type { StarPhysical } from '../../generation/stars';
import type { BodyKind } from '../../pick';
import type { OrbitElements } from '../../sim/orbits';
import type { AtmosphereMaterialHandle } from './atmosphere-material';
import type { CloudMaterialHandle } from './cloud-material';
import type { PlanetMaterialHandle } from './planet-material';
import type { RingMaterialHandle } from './planet-rings';
import type { AtmosphereLook, CloudLook } from './planet-surface';
import type { RecyclePool } from './recycle-pool';
import type { StarMaterialHandle } from './star-material';

import { Scene3DRenderer } from '@pierre/ecs/modules/render-scene3d';
import { Position3DDef } from '@pierre/ecs/modules/transform-3d';
import { Color, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

import { ATMOSPHERE_LOOKS, CLOUD_LOOKS, STAR_MIN_SCREEN_PX, STAR_SPIN_RATE } from '../../config/render';
import { BodyVisualDef } from '../../generation/body-visual';
import { BlackHoleDef } from '../../generation/galaxies';
import { MoonPhysicalDef } from '../../generation/moons';
import { oblateness, PlanetPhysicalDef } from '../../generation/planets';
import { StarPhysicalDef } from '../../generation/stars';
import { OrbitElementsDef, tiltNormal } from '../../sim/orbits';
import { oblatePolarScale } from '../body-scale';
import { ringOuterRadius, ringVariety } from './planet-rings';
import { atmosphereKind, cloudKind, planetVarietySeed } from './planet-surface';

const DEFAULT_FILL = '#ffffff';
const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;
/** A UV sphere's north pole is its local +Y axis; planet spheres are re-oriented so this points along the spin axis. */
const SPHERE_POLE = new Vector3(0, 1, 0);
/** A ring lies in its local XY plane (normal +Z); it is re-oriented so +Z points along the planet's spin axis. */
const RING_POLE = new Vector3(0, 0, 1);
/** Light colour for an atmosphere with no star light in the scene: the glow is starlight scattered by the air, so it goes dark. */
const NO_LIGHT = new Color(0, 0, 0);
/** Draw order among the translucent shells: clouds, then the additive rim glow over them. */
const CLOUD_RENDER_ORDER = 1;
const ATMOSPHERE_RENDER_ORDER = 2;

const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();
const tmpQuat2 = new Quaternion();
const tmpHost = new Vector3();
const tmpFacing = new Vector3();
const tmpSide = new Vector3();
const tmpBasis = new Matrix4();
/** Host temperature assumed for a moon whose host planet is not streamed in. */
const FALLBACK_HOST_TEMP_K = 200;

/** A pooled mesh together with whatever owns its material (a handle, or the material itself). */
export interface PooledMesh<THandle> {
  handle: THandle;
  mesh: Mesh;
}

export interface BodyPools {
  atmosphere: RecyclePool<PooledMesh<AtmosphereMaterialHandle>>;
  cloud: RecyclePool<PooledMesh<CloudMaterialHandle>>;
  generic: RecyclePool<PooledMesh<MeshStandardMaterial>>;
  moon: RecyclePool<PooledMesh<PlanetMaterialHandle>>;
  planet: RecyclePool<PooledMesh<PlanetMaterialHandle>>;
  ring: RecyclePool<PooledMesh<RingMaterialHandle>>;
  star: RecyclePool<PooledMesh<StarMaterialHandle>>;
}

/** Per-frame inputs the passes read; set by the caller before each pass runs. */
export interface BodyFrame {
  cameraPosition: Vector3;
  focusX: number;
  focusY: number;
  /** Screen pixels per world unit at unit distance; 0 before the first resize. */
  pxFactor: number;
  simSeconds: number;
  wallClock: number;
}

/** The star nearest the camera focus, filled in by the star pass; it carries the scene light. */
export interface NearestStar {
  distSq: number;
  fill: string;
  found: boolean;
  luminosity: number;
  position: Vector3;
}

interface BodyPose {
  fill: string;
  radius: number;
  x: number;
  y: number;
  z: number;
}

type Posed<TPhysical> = Scene3DEntry<[BodyPose, TPhysical]>;
type Entry<THandle> = PooledMesh<THandle>;

/** Yields every entity with `physicalDef` that also has a body visual and a position. */
function* selectPosed<TPhysical>(world: EcsWorld, physicalDef: ComponentDef<TPhysical>): Generator<Posed<TPhysical>> {
  const visuals = world.getStore(BodyVisualDef);
  const positions = world.getStore(Position3DDef);
  for (const [id, physical] of world.query(physicalDef)) {
    const visual = visuals.get(id);
    const position = positions.get(id);
    if (!visual || !position)
      continue;
    yield [id, {
      fill: visual.color,
      radius: visual.radius,
      x: position.x,
      y: position.y,
      z: position.z,
    }, physical];
  }
}

function* selectAtmospheric(world: EcsWorld): Generator<Scene3DEntry<[BodyPose, PlanetPhysical, AtmosphereLook]>> {
  for (const [id, pose, planet] of selectPosed(world, PlanetPhysicalDef)) {
    const kind = atmosphereKind(planet);
    if (kind)
      yield [id, pose, planet, ATMOSPHERE_LOOKS[kind]];
  }
}

function* selectClouded(world: EcsWorld): Generator<Scene3DEntry<[BodyPose, PlanetPhysical, CloudLook]>> {
  for (const [id, pose, planet] of selectPosed(world, PlanetPhysicalDef)) {
    const kind = cloudKind(planet);
    if (kind)
      yield [id, pose, planet, CLOUD_LOOKS[kind]];
  }
}

function* selectRinged(world: EcsWorld): Generator<Scene3DEntry<[BodyPose, PlanetPhysical, OrbitElements]>> {
  const orbits = world.getStore(OrbitElementsDef);
  for (const [id, pose, planet] of selectPosed(world, PlanetPhysicalDef)) {
    const orbit = orbits.get(id);
    if (planet.hasRings && orbit)
      yield [id, pose, planet, orbit];
  }
}

/** The planet's spin axis: its orbit-plane normal tilted by obliquity around its azimuth. */
function planetSpinAxis(planet: PlanetPhysical, orbit: OrbitElements, out: Vector3): void {
  const sinI = Math.sin(orbit.inclination);
  const nx = sinI * Math.sin(orbit.longitudeAscendingNode);
  const ny = -sinI * Math.cos(orbit.longitudeAscendingNode);
  const nz = Math.cos(orbit.inclination);
  const [sx, sy, sz] = tiltNormal(nx, ny, nz, planet.obliquity * DEG2RAD, planet.obliquityAzimuth);
  out.set(sx, sy, sz);
}

/**
 * Orient a planet sphere so its pole points along its spin axis — the orbital
 * plane normal tilted by the axial obliquity around the stored azimuth — then
 * spin it about that axis. That is the same plane its (equatorial-orbit) moons
 * ride in, so a tilted planet and its moon disk visibly agree.
 */
function orientPlanet(mesh: Mesh, planet: PlanetPhysical, orbit: OrbitElements, simSeconds: number): void {
  planetSpinAxis(planet, orbit, tmpAxis);
  tmpQuat.setFromUnitVectors(SPHERE_POLE, tmpAxis);
  const spin = (simSeconds / (planet.rotationPeriod * 3600)) * TAU;
  tmpQuat2.setFromAxisAngle(tmpAxis, spin);
  mesh.quaternion.multiplyQuaternions(tmpQuat2, tmpQuat);
}

/**
 * Orient a moon: its pole along the host's spin axis (moons orbit in the host's
 * equatorial plane). A tidally locked moon also turns its local +X toward the
 * host, so it always shows the host the same hemisphere, as the Moon does Earth.
 */
function orientMoon(mesh: Mesh, locked: boolean, host: Vector3 | null, axis: Vector3 | null): void {
  if (!axis) {
    mesh.rotation.set(0, 0, 0);
    return;
  }
  if (locked && host) {
    tmpFacing.subVectors(host, mesh.position);
    tmpFacing.addScaledVector(axis, -tmpFacing.dot(axis));
    if (tmpFacing.lengthSq() > 0) {
      tmpFacing.normalize();
      tmpSide.crossVectors(tmpFacing, axis);
      tmpBasis.makeBasis(tmpFacing, axis, tmpSide);
      mesh.quaternion.setFromRotationMatrix(tmpBasis);
      return;
    }
  }
  mesh.quaternion.setFromUnitVectors(SPHERE_POLE, axis);
}

function stamp(mesh: Mesh, id: EntityId, kind: BodyKind): void {
  const data = mesh.userData as { id: number; kind: BodyKind };
  data.id = id;
  data.kind = kind;
}

/** Adds and removes the pooled entry's mesh in `group`; the engine calls it as bodies enter and leave. */
function meshGraph(group: Group): SceneGraph<PooledMesh<unknown>> {
  return {
    add: entry => group.add(entry.mesh),
    remove: entry => group.remove(entry.mesh),
  };
}

/**
 * Objects come from `pool` and return to it when the entity leaves the pass.
 * `Scene3DRenderer` calls `select` once per world and re-iterates the result
 * every frame, so the one-shot generator is wrapped to restart on each pass.
 */
function makePass<THandle, TRow extends unknown[]>(
  pool: RecyclePool<Entry<THandle>>,
  select: (world: EcsWorld) => Iterable<Scene3DEntry<TRow>>,
  sync: (entry: Entry<THandle>, row: Scene3DEntry<TRow>, world: EcsWorld) => void,
): Scene3DRenderer<Entry<THandle>, TRow> {
  return new Scene3DRenderer<Entry<THandle>, TRow>({
    sync,
    create: () => pool.take(),
    remove: entry => pool.give(entry),
    select: world => ({ [Symbol.iterator]: () => select(world)[Symbol.iterator]() }),
  });
}

const INITIAL_FRAME: BodyFrame = {
  cameraPosition: new Vector3(),
  focusX: 0,
  focusY: 0,
  pxFactor: 0,
  simSeconds: 0,
  wallClock: 0,
};

export class BodyPasses {
  private readonly atmospheres: Scene3DRenderer<Entry<AtmosphereMaterialHandle>, [BodyPose, PlanetPhysical, AtmosphereLook]>;
  private readonly blackHoles: Scene3DRenderer<Entry<MeshStandardMaterial>, [BodyPose, BlackHolePhysical]>;
  private readonly clouds: Scene3DRenderer<Entry<CloudMaterialHandle>, [BodyPose, PlanetPhysical, CloudLook]>;
  private frame = INITIAL_FRAME;
  private readonly graph: SceneGraph<PooledMesh<unknown>>;
  private light: PointLight | null = null;
  private readonly moons: Scene3DRenderer<Entry<PlanetMaterialHandle>, [BodyPose, MoonPhysical]>;
  readonly nearestStar: NearestStar = { distSq: Infinity, fill: DEFAULT_FILL, found: false, luminosity: 0, position: new Vector3() };
  private readonly planets: Scene3DRenderer<Entry<PlanetMaterialHandle>, [BodyPose, PlanetPhysical]>;
  private readonly pools: BodyPools;
  private readonly rings: Scene3DRenderer<Entry<RingMaterialHandle>, [BodyPose, PlanetPhysical, OrbitElements]>;
  private readonly stars: Scene3DRenderer<Entry<StarMaterialHandle>, [BodyPose, StarPhysical]>;

  constructor(pools: BodyPools, group: Group) {
    this.pools = pools;
    this.graph = meshGraph(group);
    this.stars = makePass(pools.star, world => selectPosed(world, StarPhysicalDef), (entry, row) => this.syncStar(entry, row));
    this.planets = makePass(pools.planet, world => selectPosed(world, PlanetPhysicalDef), (entry, row, world) => this.syncPlanet(entry, row, world));
    this.clouds = makePass(pools.cloud, selectClouded, (entry, row, world) => this.syncClouds(entry, row, world));
    this.atmospheres = makePass(pools.atmosphere, selectAtmospheric, (entry, row, world) => this.syncAtmosphere(entry, row, world));
    this.rings = makePass(pools.ring, selectRinged, (entry, row) => this.syncRing(entry, row));
    this.moons = makePass(pools.moon, world => selectPosed(world, MoonPhysicalDef), (entry, row, world) => this.syncMoon(entry, row, world));
    this.blackHoles = makePass(pools.generic, world => selectPosed(world, BlackHoleDef), (entry, row) => this.syncGeneric(entry, row, 'black-hole'));
  }

  /** Release every mesh, then free the GPU materials of everything ever built. */
  dispose(): void {
    this.releaseAll();
    this.pools.star.forEach(entry => entry.handle.dispose());
    this.pools.planet.forEach(entry => entry.handle.dispose());
    this.pools.atmosphere.forEach(entry => entry.handle.dispose());
    this.pools.cloud.forEach(entry => entry.handle.dispose());
    this.pools.ring.forEach(entry => entry.handle.dispose());
    this.pools.generic.forEach(entry => entry.handle.dispose());
    this.pools.moon.forEach(entry => entry.handle.dispose());
  }

  /** Detach every held mesh back to its pool. Call after a world reset: entity ids restart, so held meshes must not match new entities. */
  releaseAll(): void {
    this.stars.dispose(this.graph);
    this.planets.dispose(this.graph);
    this.clouds.dispose(this.graph);
    this.atmospheres.dispose(this.graph);
    this.rings.dispose(this.graph);
    this.moons.dispose(this.graph);
    this.blackHoles.dispose(this.graph);
  }

  /** Planets, their clouds and atmospheres, rings, moons and black holes. `light` is the star light, or null when none is placed. */
  renderBodies(world: EcsWorld, frame: BodyFrame, light: PointLight | null): void {
    this.frame = frame;
    this.light = light;
    const context = { graph: this.graph, world };
    this.planets.render(context);
    this.clouds.render(context);
    this.atmospheres.render(context);
    this.rings.render(context);
    this.moons.render(context);
    this.blackHoles.render(context);
  }

  /** Stars pass. Returns the star nearest the focus so the caller can place the scene light before `renderBodies`. */
  renderStars(world: EcsWorld, frame: BodyFrame): NearestStar {
    this.frame = frame;
    const nearest = this.nearestStar;
    nearest.distSq = Infinity;
    nearest.found = false;
    this.stars.render({ graph: this.graph, world });
    return nearest;
  }

  /**
   * The rim-glow shell: the planet's pose, oblate scale and spin, enlarged to
   * the family's shell radius. Not stamped, so picking ignores it.
   */
  private syncAtmosphere({ handle, mesh }: Entry<AtmosphereMaterialHandle>, [id, pose, planet, look]: Scene3DEntry<[BodyPose, PlanetPhysical, AtmosphereLook]>, world: EcsWorld): void {
    const shell = handle.setLook(look);
    mesh.renderOrder = ATMOSPHERE_RENDER_ORDER;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius * shell);
    mesh.scale.y = mesh.scale.x * oblatePolarScale(oblateness(planet.rotationPeriod, planet.mass, planet.radius));
    const orbit = world.getStore(OrbitElementsDef).get(id);
    if (orbit)
      orientPlanet(mesh, planet, orbit, this.frame.simSeconds);
    else
      mesh.rotation.set(0, 0, 0);
    const light = this.light;
    if (light && light.visible)
      handle.setLight(light.position, light.color);
    else
      handle.setLight(mesh.position, NO_LIGHT);
  }

  /** The cloud shell: the planet's pose, oblate scale and spin, just above its surface. Not stamped (unpickable). */
  private syncClouds({ handle, mesh }: Entry<CloudMaterialHandle>, [id, pose, planet, look]: Scene3DEntry<[BodyPose, PlanetPhysical, CloudLook]>, world: EcsWorld): void {
    const shell = handle.setClouds(look, planetVarietySeed(planet));
    mesh.renderOrder = CLOUD_RENDER_ORDER;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius * shell);
    mesh.scale.y = mesh.scale.x * oblatePolarScale(oblateness(planet.rotationPeriod, planet.mass, planet.radius));
    const orbit = world.getStore(OrbitElementsDef).get(id);
    if (orbit)
      orientPlanet(mesh, planet, orbit, this.frame.simSeconds);
    else
      mesh.rotation.set(0, 0, 0);
  }

  private syncGeneric({ handle, mesh }: Entry<MeshStandardMaterial>, [id, pose]: Scene3DEntry<[BodyPose, unknown]>, kind: BodyKind): void {
    handle.color.set(pose.fill);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius);
    mesh.rotation.set(0, 0, 0);
    stamp(mesh, id, kind);
  }

  /** A moon: the moon surface at its host's temperature, oriented on the host's spin axis. */
  private syncMoon({ handle, mesh }: Entry<PlanetMaterialHandle>, [id, pose, moon]: Scene3DEntry<[BodyPose, MoonPhysical]>, world: EcsWorld): void {
    handle.setFill(pose.fill);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius);
    stamp(mesh, id, 'moon');
    const orbits = world.getStore(OrbitElementsDef);
    const parent = orbits.get(id)?.parent ?? -1;
    const hostId = parent as EntityId;
    const host = parent >= 0 ? world.getStore(PlanetPhysicalDef).get(hostId) : undefined;
    handle.setMoon(moon, host?.equilibriumTemp ?? FALLBACK_HOST_TEMP_K);
    const hostOrbit = host ? orbits.get(hostId) : undefined;
    if (host && hostOrbit)
      planetSpinAxis(host, hostOrbit, tmpAxis);
    const hostPosition = host ? world.getStore(Position3DDef).get(hostId) : undefined;
    if (hostPosition)
      tmpHost.set(hostPosition.x, hostPosition.y, hostPosition.z);
    orientMoon(mesh, moon.tidallyLocked, hostPosition ? tmpHost : null, host && hostOrbit ? tmpAxis : null);
  }

  private syncPlanet({ handle, mesh }: Entry<PlanetMaterialHandle>, [id, pose, planet]: Scene3DEntry<[BodyPose, PlanetPhysical]>, world: EcsWorld): void {
    handle.setFill(pose.fill);
    handle.setPlanet(planet);
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(pose.radius);
    stamp(mesh, id, 'planet');
    // Squash the sphere at its equator by its rotational flattening: the drawn
    // radius is the equatorial radius, and the local +Y axis (which
    // `orientPlanet` aligns to the spin axis) is shortened to the polar radius.
    mesh.scale.y = mesh.scale.x * oblatePolarScale(oblateness(planet.rotationPeriod, planet.mass, planet.radius));
    const orbit = world.getStore(OrbitElementsDef).get(id);
    if (orbit)
      orientPlanet(mesh, planet, orbit, this.frame.simSeconds);
    else
      mesh.rotation.set(0, 0, 0);
  }

  /**
   * A translucent disc in the planet's equatorial plane, scaled to the planet's
   * drawn radius and oriented on its spin axis, lit by the star with the
   * planet's shadow band carved across it and coloured by temperature.
   */
  private syncRing({ handle, mesh }: Entry<RingMaterialHandle>, [, pose, planet, orbit]: Scene3DEntry<[BodyPose, PlanetPhysical, OrbitElements]>): void {
    const light = this.light;
    mesh.position.set(pose.x, pose.y, pose.z);
    mesh.scale.setScalar(ringOuterRadius(pose.radius, ringVariety(planet.mass, planet.equilibriumTemp)));
    planetSpinAxis(planet, orbit, tmpAxis);
    mesh.quaternion.setFromUnitVectors(RING_POLE, tmpAxis);
    handle.setRing(mesh.position, pose.radius, light ? light.position : mesh.position, light && light.visible ? 1 : 0, planet.mass, planet.equilibriumTemp);
  }

  private syncStar({ handle, mesh }: Entry<StarMaterialHandle>, [id, pose, star]: Scene3DEntry<[BodyPose, StarPhysical]>): void {
    const frame = this.frame;
    mesh.position.set(pose.x, pose.y, pose.z);
    // Floor the on-screen size: a star's true disc shrinks below a pixel from
    // a distant planet and vanishes, but a real star stays a bright glare
    // point — so never draw it smaller than `STAR_MIN_SCREEN_PX` (bloom then
    // turns the floored dot into a visible glow). Guard the pre-resize case
    // where `pxFactor` is 0 (avoids an infinite radius).
    const distToCam = frame.cameraPosition.distanceTo(mesh.position);
    const minRadius = frame.pxFactor > 0 ? (STAR_MIN_SCREEN_PX * distToCam) / frame.pxFactor : 0;
    mesh.scale.setScalar(Math.max(pose.radius, minRadius));
    mesh.rotation.set(0, frame.simSeconds * STAR_SPIN_RATE, 0);
    handle.setStar(pose.fill, star.temperature);
    handle.setTime(frame.wallClock);
    stamp(mesh, id, 'star');
    const dx = pose.x - frame.focusX;
    const dy = pose.y - frame.focusY;
    const distSq = dx * dx + dy * dy;
    const nearest = this.nearestStar;
    if (distSq < nearest.distSq) {
      nearest.distSq = distSq;
      nearest.fill = pose.fill;
      nearest.found = true;
      nearest.luminosity = star.luminosity;
      nearest.position.copy(mesh.position);
    }
  }
}
