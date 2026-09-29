/** Pure view maths for the planet lab's size preview. */

/**
 * Camera distance at which a sphere of `radius` spans `diameterPx` pixels on a
 * viewport `viewportPx` pixels tall with vertical field of view `fovDeg`.
 * Exact for a perspective camera: the sphere's silhouette subtends
 * `2·asin(radius / distance)`.
 */
export function distanceForDiameter(radius: number, diameterPx: number, viewportPx: number, fovDeg: number): number {
  const halfFov = (fovDeg * Math.PI) / 360;
  const halfAngle = Math.atan((diameterPx / viewportPx) * Math.tan(halfFov));
  return radius / Math.sin(halfAngle);
}
