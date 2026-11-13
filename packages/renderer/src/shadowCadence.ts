/**
 * When the sun's shadow map is redrawn. The shadow pass draws every caster again,
 * crowns included, from the sun; at 60 fps a unit walks about 5 cm a frame and a
 * crown sways less, so a shadow one frame old is not something the eye can find.
 * Drawing it every other frame halves the pass.
 *
 * Three.js keeps the light's shadow matrix from the last time the map was drawn,
 * so a stale map is still a consistent one: it lags, it does not slide. The one
 * case that shows is a big move of the shadow camera (a pan, a zoom, a jump to an
 * alert), which uncovers ground the old map never saw: that redraws at once.
 *
 * Pure, so it is tested without WebGL.
 */
export interface ShadowCadenceOptions {
  /** Redraw at least once every this many frames. */
  every: number;
  /** A shadow camera that moved this far (metres) or resized redraws immediately. */
  moveM: number;
}

export const SHADOW_CADENCE: ShadowCadenceOptions = { every: 2, moveM: 6 };

export class ShadowCadence {
  private since = Infinity;
  private x = NaN;
  private z = NaN;
  private half = NaN;
  private readonly o: ShadowCadenceOptions;

  constructor(options: Partial<ShadowCadenceOptions> = {}) {
    this.o = { ...SHADOW_CADENCE, ...options };
  }

  /** Forgets the last draw, so the next frame redraws (a new map, a forced capture). */
  invalidate(): void {
    this.since = Infinity;
  }

  /**
   * Whether this frame should redraw the map, given where the shadow camera is
   * centred and its half width.
   */
  due(x: number, z: number, half: number): boolean {
    const moved = !(Math.hypot(x - this.x, z - this.z) < this.o.moveM) || Math.abs(half - this.half) > 1;
    this.since++;
    if (!moved && this.since < this.o.every) return false;
    this.since = 0;
    this.x = x;
    this.z = z;
    this.half = half;
    return true;
  }
}

/**
 * Snaps a centre to whole shadow-map texels along the light's own axes, so a pan
 * slides the map by whole texels and shadow edges stop crawling. `right` and `up`
 * are the light camera's unit axes in world space.
 */
export function snapToTexels(
  centre: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  texel: number,
): { x: number; y: number; z: number } {
  const r = centre.x * right.x + centre.y * right.y + centre.z * right.z;
  const u = centre.x * up.x + centre.y * up.y + centre.z * up.z;
  const dr = Math.round(r / texel) * texel - r;
  const du = Math.round(u / texel) * texel - u;
  return {
    x: centre.x + right.x * dr + up.x * du,
    y: centre.y + right.y * dr + up.y * du,
    z: centre.z + right.z * dr + up.z * du,
  };
}
