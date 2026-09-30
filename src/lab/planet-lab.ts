/**
 * Planet lab — a dev-only page (`/lab.html`, not part of the production build)
 * for tuning planet surface and atmosphere looks by eye
 * (docs/plans/planet-surfaces.md).
 * One planet, large, lit by a movable point light, with live sliders driving the
 * same material the app uses; tuned values are copied out as JSON.
 */

import type { PlanetPhysical } from '../generation/planets';
import type { AlbedoSource } from '../render/three/planet-material';
import type { AtmosphereKind, AtmosphereLook, RockyTuning } from '../render/three/planet-surface';
import type { PlanetSurface } from '../render/three/surface-bake';
import type { LabPlanet } from './lab-planets';
import type { ProbeParams } from './probe-surface';

import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mix, uniform, uv, vec3 } from 'three/tsl';
import { AmbientLight, ColorManagement, Group, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PointLight, Scene, SphereGeometry, WebGPURenderer } from 'three/webgpu';

import { ATMOSPHERE_LOOKS, CAMERA_FOV_DEG, LIGHT_AMBIENT, LIGHT_STAR_BASE, RENDER_ANTIALIAS, ROCKY_SURFACE, SPHERE_HEIGHT_SEGMENTS, SPHERE_WIDTH_SEGMENTS } from '../config/render';
import { oblateness } from '../generation/planets';
import { parseSave, SAVE_KEY } from '../persistence/save';
import { oblatePolarScale } from '../render/body-scale';
import { createAtmosphereMaterial } from '../render/three/atmosphere-material';
import { createPlanetMaterial } from '../render/three/planet-material';
import { ATMOSPHERE_KINDS, atmosphereKind, isRockyType, planetVarietySeed, rockyRegime } from '../render/three/planet-surface';
import { sphereDirFromUv } from '../render/three/surface-bake';
import { scanPlanets } from './lab-planets';
import { distanceForDiameter } from './lab-view';
import { createProbeSurface, PROBE_DEFAULTS } from './probe-surface';

/** Matches the app's system-view background. */
const BACKGROUND = 0x05060D;
const STATE_KEY = 'procuniverse:planet-lab';
const SCAN_LIMIT = 150;
const LIGHT_DISTANCE = 100;
const MAP_WIDTH_PX = 320;
const MAP_MARGIN_PX = 8;
const DEG2RAD = Math.PI / 180;

type SizePreset = 'free' | '150' | '48' | '16';
/** Which atmosphere family to show: the planet's own (`auto`), a forced one, or none. */
type AtmosphereMode = 'auto' | 'off' | AtmosphereKind;

interface LabState {
  atmosphere: Record<AtmosphereKind, AtmosphereLook>;
  atmosphereMode: AtmosphereMode;
  fill: string;
  planet: PlanetPhysical;
  probe: ProbeParams;
  rocky: RockyTuning;
  seed: number;
  source: AlbedoSource;
  /** `planet` = what the game draws for this planet; `probe` = the test pattern. */
  surface: 'flat' | 'planet' | 'probe';
  view: {
    lightAzimuth: number;
    lightColor: string;
    lightElevation: number;
    mapShows: 'albedo' | 'height';
    pixelZoom: number;
    showMap: boolean;
    size: SizePreset;
    spin: number;
  };
}

const JUPITER_LIKE: PlanetPhysical = {
  density: 1.33,
  equilibriumTemp: 110,
  hasRings: false,
  inHabitableZone: false,
  insolation: 0.037,
  mass: 317.8,
  moonRichness: 1,
  obliquity: 3,
  obliquityAzimuth: 0,
  radius: 11.2,
  rotationPeriod: 9.9,
  tidallyLocked: false,
  type: 'gas-giant',
  waterState: 'ice',
};

const EARTH_LIKE: PlanetPhysical = {
  ...JUPITER_LIKE,
  density: 5.51,
  equilibriumTemp: 255,
  inHabitableZone: true,
  insolation: 1,
  mass: 1,
  obliquity: 23.4,
  radius: 1,
  rotationPeriod: 23.9,
  type: 'rocky',
  waterState: 'liquid',
};

function defaultState(): LabState {
  let seed = 1;
  try {
    seed = parseSave(localStorage.getItem(SAVE_KEY))?.seed ?? 1;
  }
  catch {}
  const atmosphere = Object.fromEntries(ATMOSPHERE_KINDS.map(kind => [kind, { ...ATMOSPHERE_LOOKS[kind] }])) as Record<AtmosphereKind, AtmosphereLook>;
  return {
    atmosphere,
    atmosphereMode: 'auto',
    fill: '#c9b88f',
    planet: { ...EARTH_LIKE },
    probe: { ...PROBE_DEFAULTS },
    rocky: JSON.parse(JSON.stringify(ROCKY_SURFACE)) as RockyTuning,
    seed,
    source: 'baked',
    surface: 'planet',
    view: { lightAzimuth: 60, lightColor: '#ffffff', lightElevation: 15, mapShows: 'albedo', pixelZoom: 1, showMap: true, size: 'free', spin: 0.1 },
  };
}

/**
 * Copy into `target` only the keys it already has, and only when the incoming
 * value has the same type — pasted / stored JSON is untrusted and must not
 * inject unknown fields or wrong types into the live state.
 */
function mergeKnown(target: Record<string, unknown>, input: unknown): void {
  if (typeof input !== 'object' || input === null)
    return;
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    const current = target[key];
    const incoming = source[key];
    if (typeof current === 'object' && current !== null)
      mergeKnown(current as Record<string, unknown>, incoming);
    else if (typeof incoming === typeof current && (typeof incoming !== 'number' || Number.isFinite(incoming)))
      target[key] = incoming;
  }
}

function loadState(): LabState {
  const state = defaultState();
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw)
      mergeKnown(state as unknown as Record<string, unknown>, JSON.parse(raw));
  }
  catch {}
  return state;
}

function saveState(state: LabState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
  catch {}
}

async function start(root: HTMLElement): Promise<void> {
  ColorManagement.enabled = false;
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new WebGPURenderer({ antialias: RENDER_ANTIALIAS, forceWebGL });
  renderer.setClearColor(BACKGROUND, 1);
  renderer.autoClear = false;
  root.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block; width:100%; height:100%; image-rendering:pixelated;';
  await renderer.init();

  const state = loadState();

  const scene = new Scene();
  scene.add(new AmbientLight(0xFFFFFF, LIGHT_AMBIENT));
  const light = new PointLight(0xFFFFFF, LIGHT_STAR_BASE, 0, 0);
  scene.add(light);

  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 10000);
  camera.position.set(0, 0, 4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;

  // Tilt holds the axial obliquity; the mesh spins about its local +Y (the pole).
  const tilt = new Group();
  scene.add(tilt);
  const geometry = new SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
  const handle = createPlanetMaterial();
  const mesh = new Mesh(geometry, handle.material);
  tilt.add(mesh);
  // Child of the planet mesh, so it inherits the oblate scale and spin exactly.
  const atmosphere = createAtmosphereMaterial();
  const atmosphereMesh = new Mesh(geometry, atmosphere.material);
  mesh.add(atmosphereMesh);

  const probe = createProbeSurface();

  // Flat equirectangular view of the surface function itself (north up).
  const mapScene = new Scene();
  const mapCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  const mapMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const uMapHeight = uniform(0);
  let mapped: PlanetSurface | null = null;
  const syncMap = (): void => {
    uMapHeight.value = state.view.mapShows === 'height' ? 1 : 0;
    const surface = handle.surface();
    if (surface === mapped)
      return;
    mapped = surface;
    if (surface) {
      const sampled = surface.sample(sphereDirFromUv(uv()));
      mapMaterial.colorNode = mix(sampled.rgb, vec3(sampled.a), uMapHeight);
      mapMaterial.needsUpdate = true;
    }
  };
  const mapMesh = new Mesh(new PlaneGeometry(1, 1), mapMaterial);
  mapMesh.position.z = -0.5;
  mapScene.add(mapMesh);

  let installed = '';
  const regimeStatus = { capStart: '', craters: 0, molten: 0, ocean: false, surfaceTempK: 0 };

  const applySurface = (): void => {
    probe.set(state.probe, planetVarietySeed(state.planet));
    const key = state.surface === 'planet' ? 'planet' : `${state.surface}/${state.source}`;
    if (state.surface === 'planet') {
      handle.setPlanet(state.planet, state.rocky);
      if (isRockyType(state.planet.type)) {
        const regime = rockyRegime(state.planet, state.rocky);
        regimeStatus.surfaceTempK = Math.round(regime.surfaceTempK);
        regimeStatus.ocean = regime.ocean;
        regimeStatus.capStart = regime.capStart > 1 ? 'none' : regime.capStart.toFixed(2);
        regimeStatus.molten = Number(regime.molten.toFixed(2));
        regimeStatus.craters = regime.craters;
      }
    }
    else if (key !== installed) {
      handle.setSurface(state.surface === 'probe' ? probe.surface : null, state.source);
    }
    installed = key;
    // Tuning edits keep the planet's regime (so `setPlanet` does not re-bake): always refresh.
    handle.refreshSurface();
    syncMap();
  };

  const atmosphereStatus = { detected: '' };
  let lookKind: AtmosphereKind | null = null;
  let rebuildLookFolder: (kind: AtmosphereKind | null) => void = () => {};
  const applyAtmosphere = (): void => {
    const detected = atmosphereKind(state.planet);
    atmosphereStatus.detected = detected ?? 'none';
    const mode = state.atmosphereMode;
    const kind = mode === 'auto' ? detected : mode === 'off' ? null : mode;
    atmosphereMesh.visible = kind !== null;
    if (kind)
      atmosphereMesh.scale.setScalar(atmosphere.setLook(state.atmosphere[kind]));
    if (kind !== lookKind) {
      lookKind = kind;
      rebuildLookFolder(kind);
    }
  };

  const applyPlanet = (): void => {
    handle.setFill(state.fill);
    const p = state.planet;
    mesh.scale.set(1, oblatePolarScale(oblateness(p.rotationPeriod, p.mass, p.radius)), 1);
    tilt.rotation.set(0, 0, p.obliquity * DEG2RAD);
    applySurface();
    applyAtmosphere();
  };

  const applyLight = (): void => {
    const az = state.view.lightAzimuth * DEG2RAD;
    const el = state.view.lightElevation * DEG2RAD;
    light.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(LIGHT_DISTANCE);
    light.color.set(state.view.lightColor);
    atmosphere.setLight(light.position, light.color);
  };

  const applyView = (): void => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const zoom = Math.max(1, state.view.pixelZoom);
    renderer.setPixelRatio(1 / zoom);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    const fixed = state.view.size !== 'free';
    controls.enableZoom = !fixed;
    if (fixed) {
      const bufferHeight = Math.max(1, Math.floor(height / zoom));
      camera.position.setLength(distanceForDiameter(1, Number(state.view.size), bufferHeight, CAMERA_FOV_DEG));
    }
  };

  // ── Controls ──────────────────────────────────────────────────────────
  const gui = new GUI({ title: `Planet lab (${forceWebGL ? 'WebGL2' : 'WebGPU / auto'})` });
  gui.onChange(() => saveState(state));

  let planets: LabPlanet[] = [];
  const picker = { index: -1 };
  const planetFolder = gui.addFolder('Planet');
  const pickFolder = planetFolder.addFolder('Real planet');
  let pickCtrl: ReturnType<GUI['add']> | null = null;
  const rebuildPicker = (): void => {
    pickCtrl?.destroy();
    const options: Record<string, number> = {};
    planets.forEach((planet, i) => {
      options[planet.label] = i;
    });
    pickCtrl = pickFolder.add(picker, 'index', options).name('pick').onChange((i: number) => {
      const chosen = planets[i];
      if (!chosen)
        return;
      // Mutate in place: the editable sliders are bound to this object.
      Object.assign(state.planet, chosen.physical);
      state.fill = chosen.fill;
      gui.controllersRecursive().forEach(c => c.updateDisplay());
      applyPlanet();
      saveState(state);
    });
  };
  const scan = (): void => {
    planets = scanPlanets(state.seed, SCAN_LIMIT);
    picker.index = -1;
    rebuildPicker();
  };
  pickFolder.add(state, 'seed').step(1).name('universe seed');
  pickFolder.add({ scan }, 'scan').name('scan planets');

  const editFolder = planetFolder.addFolder('Physical (editable)');
  editFolder.add(state.planet, 'type', ['gas-giant', 'ice-giant', 'rocky', 'super-earth']).onChange(applyPlanet);
  editFolder.add(state.planet, 'equilibriumTemp', 20, 2500, 1).name('Teq (K)').onChange(applyPlanet);
  editFolder.add(state.planet, 'rotationPeriod', 2, 2000, 0.1).name('rotation (h)').onChange(applyPlanet);
  editFolder.add(state.planet, 'waterState', ['ice', 'liquid', 'vapour']).onChange(applyPlanet);
  editFolder.add(state.planet, 'insolation').name('insolation (S⊕)').onChange(applyPlanet);
  editFolder.add(state.planet, 'mass', 0.01, 4000, 0.01).name('mass (M⊕)').onChange(applyPlanet);
  editFolder.add(state.planet, 'radius', 0.1, 25, 0.01).name('radius (R⊕)').onChange(applyPlanet);
  editFolder.add(state.planet, 'obliquity', 0, 180, 0.5).name('obliquity (°)').onChange(applyPlanet);
  editFolder.addColor(state, 'fill').name('flat fill').onChange(applyPlanet);

  const surfaceFolder = gui.addFolder('Surface');
  surfaceFolder.add(state, 'surface', ['planet', 'probe', 'flat']).onChange(applySurface);
  surfaceFolder.add(state, 'source', ['baked', 'per-pixel']).name('source (probe only)').onChange(applySurface);

  const rockyFolder = surfaceFolder.addFolder('Rocky worlds');
  const regimeFolder = rockyFolder.addFolder('This planet gets');
  regimeFolder.add(regimeStatus, 'surfaceTempK').name('surface temp (K)').disable().listen();
  regimeFolder.add(regimeStatus, 'ocean').disable().listen();
  regimeFolder.add(regimeStatus, 'capStart').name('caps from |y|').disable().listen();
  regimeFolder.add(regimeStatus, 'molten').disable().listen();
  regimeFolder.add(regimeStatus, 'craters').name('crater strength').disable().listen();
  const r = state.rocky;
  const terrainFolder = rockyFolder.addFolder('Terrain & relief');
  terrainFolder.add(r, 'continentScale', 0.3, 8, 0.05).name('continent size (freq)').onChange(applySurface);
  terrainFolder.add(r, 'octaves', 1, 10, 1).name('detail octaves').onChange(applySurface);
  terrainFolder.add(r, 'diminish', 0.2, 0.8, 0.01).name('roughness').onChange(applySurface);
  terrainFolder.add(r, 'relief', 0, 0.2, 0.001).name('relief (radii)').onChange(applySurface);
  const craterFolder = rockyFolder.addFolder('Craters');
  craterFolder.add(r, 'craterScale', 1, 20, 0.1).name('frequency').onChange(applySurface);
  craterFolder.add(r, 'craterDensity', 0, 1, 0.01).name('density').onChange(applySurface);
  craterFolder.add(r, 'craterSize', 0.05, 0.5, 0.01).name('size').onChange(applySurface);
  craterFolder.add(r, 'craterDepth', 0, 1, 0.01).name('depth').onChange(applySurface);
  craterFolder.add(r, 'craterAtmosphereFactor', 0, 1, 0.01).name('kept under atmosphere').onChange(applySurface);
  const waterFolder = rockyFolder.addFolder('Oceans & ice caps');
  waterFolder.add(r, 'seaLevel', 0, 1, 0.005).name('sea level').onChange(applySurface);
  waterFolder.addColor(r, 'deepColor').name('deep water').onChange(applySurface);
  waterFolder.addColor(r, 'shallowColor').name('shallow water').onChange(applySurface);
  waterFolder.addColor(r, 'capColor').name('ice').onChange(applySurface);
  waterFolder.add(r, 'capWarmK', 100, 500, 1).name('caps vanish at (K)').onChange(applySurface);
  waterFolder.add(r, 'capColdK', 20, 400, 1).name('caps largest at (K)').onChange(applySurface);
  waterFolder.add(r, 'capColdStart', 0, 1, 0.01).name('largest caps from |y|').onChange(applySurface);
  waterFolder.add(r, 'capEdgeNoise', 0, 0.3, 0.005).name('cap edge wobble').onChange(applySurface);
  const lavaFolder = rockyFolder.addFolder('Molten worlds');
  lavaFolder.addColor(r, 'lavaColor').name('lava').onChange(applySurface);
  lavaFolder.add(r, 'lavaLevel', 0, 1, 0.005).name('lava below height').onChange(applySurface);
  lavaFolder.add(r, 'moltenStartK', 300, 2500, 10).name('melting starts (K)').onChange(applySurface);
  lavaFolder.add(r, 'moltenFullK', 300, 3000, 10).name('fully molten (K)').onChange(applySurface);
  const paletteFolder = rockyFolder.addFolder('Land colours by temperature');
  r.anchors.forEach((anchor, i) => {
    const anchorFolder = paletteFolder.addFolder(`stop ${i + 1}`);
    anchorFolder.add(anchor, 'tempK', 0, 3000, 1).name('at (K)').onChange(applySurface);
    anchorFolder.addColor(anchor, 'low').name('lowland').onChange(applySurface);
    anchorFolder.addColor(anchor, 'high').name('highland').onChange(applySurface);
  });
  paletteFolder.close();
  const probeFolder = surfaceFolder.addFolder('Probe (test pattern)');
  probeFolder.add(state.probe, 'scale', 0.5, 64, 0.1).name('detail frequency').onChange(applySurface);
  probeFolder.add(state.probe, 'octaves', 1, 8, 1).onChange(applySurface);
  probeFolder.add(state.probe, 'contrast', 0, 3, 0.01).onChange(applySurface);
  probeFolder.addColor(state.probe, 'lowColor').onChange(applySurface);
  probeFolder.addColor(state.probe, 'highColor').onChange(applySurface);
  probeFolder.addColor(state.probe, 'capColor').onChange(applySurface);
  probeFolder.add(state.probe, 'capStart', 0, 1, 0.01).name('cap start |y|').onChange(applySurface);
  probeFolder.add(state.probe, 'capSoftness', 0, 0.5, 0.005).onChange(applySurface);

  const atmosphereFolder = gui.addFolder('Atmosphere (rim glow)');
  atmosphereFolder.add(atmosphereStatus, 'detected').name('planet has').disable().listen();
  atmosphereFolder.add(state, 'atmosphereMode', ['auto', 'off', ...ATMOSPHERE_KINDS]).name('show').onChange(applyAtmosphere);
  let lookFolder: GUI | null = null;
  rebuildLookFolder = (kind) => {
    lookFolder?.destroy();
    lookFolder = null;
    if (!kind)
      return;
    const look = state.atmosphere[kind];
    lookFolder = atmosphereFolder.addFolder(`Look: ${kind}`);
    lookFolder.addColor(look, 'tint').onChange(applyAtmosphere);
    lookFolder.add(look, 'intensity', 0, 4, 0.01).onChange(applyAtmosphere);
    lookFolder.add(look, 'scaleHeight', 0.002, 0.2, 0.001).name('thickness (radii)').onChange(applyAtmosphere);
    lookFolder.add(look, 'twilight', 0, 1, 0.01).name('night wrap').onChange(applyAtmosphere);
  };

  const viewFolder = gui.addFolder('View');
  viewFolder.add(state.view, 'size', { '16 px': '16', '48 px': '48', '150 px': '150', 'free (orbit + zoom)': 'free' }).name('planet size').onChange(applyView);
  viewFolder.add(state.view, 'pixelZoom', { '×1': 1, '×2': 2, '×4': 4, '×8': 8 }).name('pixel zoom').onChange(applyView);
  viewFolder.add(state.view, 'spin', 0, 2, 0.01).name('spin (rad/s)');
  viewFolder.add(state.view, 'lightAzimuth', -180, 180, 1).name('light azimuth (°)').onChange(applyLight);
  viewFolder.add(state.view, 'lightElevation', -89, 89, 1).name('light elevation (°)').onChange(applyLight);
  viewFolder.addColor(state.view, 'lightColor').name('light colour').onChange(applyLight);
  viewFolder.add(state.view, 'showMap').name('show flat map');
  viewFolder.add(state.view, 'mapShows', ['albedo', 'height']).name('map shows').onChange(syncMap);
  viewFolder.add({ toggleBackend: () => {
    const url = new URL(location.href);
    if (forceWebGL)
      url.searchParams.delete('webgl');
    else
      url.searchParams.set('webgl', '1');
    location.href = url.toString();
  } }, 'toggleBackend').name(forceWebGL ? 'switch to WebGPU' : 'switch to WebGL2');

  const reapplyAll = (): void => {
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    applyPlanet();
    applyLight();
    applyView();
    saveState(state);
  };
  const paramsFolder = gui.addFolder('Parameters');
  paramsFolder.add({ copy: () => {
    void navigator.clipboard.writeText(JSON.stringify(state, null, 2));
  } }, 'copy').name('copy all as JSON');
  const pasteCtrl = paramsFolder.add({ paste: async () => {
    try {
      mergeKnown(state as unknown as Record<string, unknown>, JSON.parse(await navigator.clipboard.readText()));
      pasteCtrl.name('paste JSON from clipboard');
    }
    catch {
      pasteCtrl.name('paste failed: clipboard is not lab JSON');
      return;
    }
    reapplyAll();
  } }, 'paste').name('paste JSON from clipboard');
  paramsFolder.add({ reset: () => {
    mergeKnown(state as unknown as Record<string, unknown>, defaultState());
    reapplyAll();
  } }, 'reset').name('reset to defaults');

  mountReferenceStrip(document.body);

  scan();
  applyPlanet();
  applyLight();
  applyView();
  new ResizeObserver(applyView).observe(root);

  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    mesh.rotation.y += state.view.spin * dt;
    controls.update();

    renderer.setViewport(0, 0, root.clientWidth, root.clientHeight);
    renderer.clear();
    renderer.render(scene, camera);
    if (state.view.showMap && mapped) {
      renderer.setViewport(MAP_MARGIN_PX, MAP_MARGIN_PX, MAP_WIDTH_PX, MAP_WIDTH_PX / 2);
      renderer.render(mapScene, mapCamera);
    }
  });
}

/**
 * A strip of local reference images (e.g. Jupiter / Neptune photos) to compare
 * against. Images are read from disk via object URLs and never uploaded or
 * committed.
 */
function mountReferenceStrip(parent: HTMLElement): void {
  const strip = document.createElement('div');
  strip.style.cssText = 'position:fixed; left:8px; top:8px; display:flex; gap:6px; align-items:flex-start; max-width:60vw; flex-wrap:wrap; font:12px system-ui; color:#cfe3ff;';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.title = 'Add reference images';
  const clear = document.createElement('button');
  clear.textContent = 'clear refs';
  const urls: string[] = [];
  const images: HTMLImageElement[] = [];
  input.addEventListener('change', () => {
    for (const file of input.files ?? []) {
      const url = URL.createObjectURL(file);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name;
      img.style.cssText = 'height:160px; border:1px solid #334; background:#000;';
      images.push(img);
      strip.appendChild(img);
    }
    input.value = '';
  });
  clear.addEventListener('click', () => {
    images.splice(0).forEach(img => img.remove());
    urls.splice(0).forEach(url => URL.revokeObjectURL(url));
  });
  strip.append(input, clear);
  parent.appendChild(strip);
}

const root = document.getElementById('lab');
if (root)
  void start(root);
