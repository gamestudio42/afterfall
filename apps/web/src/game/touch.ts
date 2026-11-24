/** A finger that barely moved is a tap, not a pan. Fingers jitter more than a mouse. */
export const TAP_SLOP = 12;
/** Hold still this long, then drag, to box-select. A still hold adds to the selection. */
export const LONG_PRESS_MS = 420;

/** Pinch apart zooms in: the camera distance factor is the old span over the new one. */
export function pinchFactor(previousDistance: number, distance: number): number {
  if (previousDistance < 8 || distance < 8) return 1;
  const factor = previousDistance / distance;
  // A finger can more than double the span between samples. Reject only a glitch.
  if (factor > 4 || factor < 0.25) return 1;
  return factor;
}

/** Shortest signed turn from one two-finger angle to the next, in radians. */
export function twistDelta(previousAngle: number, angle: number): number {
  let delta = angle - previousAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Pan arguments for `RtsCamera.pan` so the ground sticks to the finger.
 * `pan` scales by distance/120, so this divides that back out and converts
 * pixels with the vertical field of view. Finger-right moves the target
 * screen-left.
 */
export function grabPan(
  dxPx: number,
  dyPx: number,
  distance: number,
  fovDeg: number,
  viewportHeight: number,
): { right: number; forward: number } {
  const fov = (fovDeg * Math.PI) / 180;
  const worldPerPx = (2 * Math.tan(fov / 2) * Math.max(distance, 1)) / Math.max(1, viewportHeight);
  const scale = worldPerPx / Math.max(0.05, distance / 120);
  return { right: -dxPx * scale, forward: dyPx * scale };
}
