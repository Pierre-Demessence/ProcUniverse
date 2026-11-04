/**
 * The orbit camera's reference frame: a plane normal N plus two in-plane axes
 * (u, v) that the azimuth is measured in. Both the render camera and the pan
 * controller build it here so they always agree.
 *
 * The galactic plane's basis is fixed (u = −ŷ, v = x̂, N = ẑ); any other
 * plane's basis is that one carried by the minimal rotation taking ẑ onto N.
 * Because the basis depends only on N and varies smoothly with it, swinging N
 * between any two planes (see `blendPlaneNormal`) turns the view gradually,
 * with no azimuth snap along the way.
 */

export type Vec3 = readonly [number, number, number];

export interface PlaneBasis {
  n: Vec3;
  u: Vec3;
  v: Vec3;
}

export const GALACTIC_NORMAL: Vec3 = [0, 0, 1];

// Below this sin(angle from ẑ) the in-plane direction of N is ill-defined; a
// normal that close to ±ẑ rotates about the x axis.
const AXIS_EPSILON = 1e-9;

/** The in-plane (x, y) unit direction of N's tilt away from ẑ, or x̂ when N is (anti)parallel to ẑ. */
function tiltDirection(nx: number, ny: number): [number, number] {
  const len = Math.hypot(nx, ny);
  return len < AXIS_EPSILON ? [1, 0] : [nx / len, ny / len];
}

/** Basis for the plane with unit normal `n`: the galactic basis rotated so ẑ lands on `n`. */
export function planeBasis(n: Vec3): PlaneBasis {
  const [nx, ny, nz] = n;
  const cosT = Math.max(-1, Math.min(1, nz));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const [dx, dy] = tiltDirection(nx, ny);
  // Rodrigues rotation by θ about k = (−dy, dx, 0) (= ẑ × N normalised):
  // a' = a·cosθ + (k × a)·sinθ + k·(k·a)·(1 − cosθ).
  const kx = -dy;
  const ky = dx;
  const rotate = (ax: number, ay: number, az: number): Vec3 => {
    const kDotA = kx * ax + ky * ay;
    const crossX = ky * az;
    const crossY = -kx * az;
    const crossZ = kx * ay - ky * ax;
    return [
      ax * cosT + crossX * sinT + kx * kDotA * (1 - cosT),
      ay * cosT + crossY * sinT + ky * kDotA * (1 - cosT),
      az * cosT + crossZ * sinT,
    ];
  };
  return { n: rotate(0, 0, 1), u: rotate(0, -1, 0), v: rotate(1, 0, 0) };
}

/** Unit-length copy of `v`, or `fallback` when `v` is (near) zero. */
function normalised(v: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < AXIS_EPSILON ? fallback : [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A unit vector perpendicular to the unit vector `a`. */
function perpendicularTo(a: Vec3): Vec3 {
  // Cross with the axis `a` is least aligned with, so the result is well away from zero.
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalised(cross(a, axis), [1, 0, 0]);
}

/**
 * The reference-plane normal part-way (`t` ∈ [0, 1]) from the unit normal
 * `from` to the unit normal `to`: 0 = `from`, 1 = `to`, rotating along the great
 * circle between them (a slerp), so the basis built from it turns without
 * twisting. Exactly opposite normals swing through an arbitrary perpendicular.
 */
export function blendPlaneNormal(from: Vec3, to: Vec3, t: number): Vec3 {
  const k = Math.max(0, Math.min(1, t));
  if (k === 0)
    return from;
  if (k === 1)
    return to;
  const cosTheta = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  if (sinTheta < AXIS_EPSILON && cosTheta > 0)
    return from;
  // Rotate `from` by k·θ about the axis from × to (any perpendicular when opposite).
  const axis = sinTheta < AXIS_EPSILON ? perpendicularTo(from) : normalised(cross(from, to), perpendicularTo(from));
  const c = Math.cos(k * theta);
  const s = Math.sin(k * theta);
  const axisDotFrom = axis[0] * from[0] + axis[1] * from[1] + axis[2] * from[2];
  const axisCrossFrom = cross(axis, from);
  return normalised([
    from[0] * c + axisCrossFrom[0] * s + axis[0] * axisDotFrom * (1 - c),
    from[1] * c + axisCrossFrom[1] * s + axis[1] * axisDotFrom * (1 - c),
    from[2] * c + axisCrossFrom[2] * s + axis[2] * axisDotFrom * (1 - c),
  ], from);
}

/**
 * The reference plane for the current view. Inside a system it is the focused
 * disk (`systemNormal`); across the system ↔ star band (`systemBlend`) it swings
 * to the host galaxy's disk (`hostNormal`), and across the galaxy-field ↔
 * universe band (`universeBlend`) on to world +z. With no system focused the
 * host plane applies throughout the first band.
 */
export function referencePlaneNormal(systemNormal: Vec3 | null, hostNormal: Vec3, systemBlend: number, universeBlend: number): Vec3 {
  const inGalaxy = blendPlaneNormal(systemNormal ?? hostNormal, hostNormal, systemBlend);
  return blendPlaneNormal(inGalaxy, GALACTIC_NORMAL, universeBlend);
}

/**
 * Moves the plane normal `current` toward `target` along the great circle,
 * covering the fraction `1 − exp(−dtMs / timeConstantMs)` of the remaining
 * angle, so a change of host galaxy turns the view over a moment instead of
 * snapping it. Frame-rate independent.
 */
export function easePlaneNormal(current: Vec3, target: Vec3, dtMs: number, timeConstantMs: number): Vec3 {
  return blendPlaneNormal(current, target, 1 - Math.exp(-Math.max(0, dtMs) / timeConstantMs));
}
