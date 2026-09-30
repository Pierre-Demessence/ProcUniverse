/**
 * The orbit camera's reference frame: a plane normal N plus two in-plane axes
 * (u, v) that the azimuth is measured in. Both the render camera and the pan
 * controller build it here so they always agree.
 *
 * The galactic plane's basis is fixed (u = −ŷ, v = x̂, N = ẑ); any other
 * plane's basis is that one carried by the minimal rotation taking ẑ onto N.
 * Because the basis depends only on N and varies smoothly with it, swinging N
 * from a system's disk to the galactic plane (see `blendPlaneNormal`) turns the
 * view gradually, with no azimuth snap along the way.
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

/**
 * The reference-plane normal part-way (`t` ∈ [0, 1]) from a system's disk
 * normal to the galactic plane: 0 = the disk, 1 = +ẑ, rotating along the great
 * circle between them (the same rotation `planeBasis` uses, so the basis is
 * carried along without twisting).
 */
export function blendPlaneNormal(disk: Vec3, t: number): Vec3 {
  const [nx, ny, nz] = disk;
  const theta = Math.acos(Math.max(-1, Math.min(1, nz)));
  const phi = (1 - Math.max(0, Math.min(1, t))) * theta;
  const [dx, dy] = tiltDirection(nx, ny);
  const s = Math.sin(phi);
  return [dx * s, dy * s, Math.cos(phi)];
}
