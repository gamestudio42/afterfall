/** Tactical markers retain an eight-pixel radius at every zoom, with bounded world size. */
export function survivorMarkerScale(distance: number, verticalFov: number, viewportHeight: number): number {
  return Math.min(4, Math.max(0.25, (16 * distance * Math.tan((verticalFov * Math.PI) / 360)) / Math.max(1, viewportHeight)));
}

export const SURVIVOR_MARKER_HEIGHT = 2.8;
