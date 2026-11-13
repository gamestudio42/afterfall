/**
 * Trades resolution for frame rate. Fill rate is what a laptop GPU runs out of first
 * here: the post chain draws a half-float target with 4x MSAA at up to twice the
 * display's pixel ratio, so a high-DPI screen pays four times the pixels for sharpness
 * that a top-down strategy view barely shows. When frames run slow the render scale
 * steps down; after a long stretch at the display's refresh rate it steps back up.
 *
 * Pure: it is fed frame intervals and answers with a new scale, so it is tested
 * without WebGL or a clock.
 */
export interface GovernorOptions {
  /** Lowest scale it will ask for. */
  min: number;
  /** An average interval above this is slow (25 ms is 40 fps). */
  slowMs: number;
  /** An average interval below this is the display's own refresh (a 60 Hz frame is 16.7 ms). */
  fastMs: number;
  /** How long frames must stay slow before a step down. */
  dropAfterMs: number;
  /** How long they must stay fast before a step up. */
  riseAfterMs: number;
  /** Quiet time after a drop before any rise, so it does not oscillate around the limit. */
  cooldownMs: number;
  dropStep: number;
  riseStep: number;
  /** Intervals longer than this are a stall (a hidden tab, a save), not a verdict. */
  stallMs: number;
}

export const GOVERNOR_DEFAULTS: GovernorOptions = {
  min: 0.6,
  slowMs: 25,
  fastMs: 18.2,
  dropAfterMs: 1500,
  riseAfterMs: 6000,
  cooldownMs: 10000,
  dropStep: 0.1,
  riseStep: 0.05,
  stallMs: 250,
};

export class ResolutionGovernor {
  scale = 1;
  private average = 0;
  private slowFor = 0;
  private fastFor = 0;
  private sinceDrop = Infinity;
  private readonly o: GovernorOptions;

  constructor(options: Partial<GovernorOptions> = {}) {
    this.o = { ...GOVERNOR_DEFAULTS, ...options };
  }

  /** Feeds one frame interval; returns the new scale when it changes, otherwise null. */
  sample(frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > this.o.stallMs) {
      // A stall says nothing about steady load, and must not count as time spent slow.
      this.slowFor = 0;
      this.fastFor = 0;
      return null;
    }
    this.average = this.average === 0 ? frameMs : this.average * 0.9 + frameMs * 0.1;
    this.sinceDrop += frameMs;
    this.slowFor = this.average > this.o.slowMs ? this.slowFor + frameMs : 0;
    this.fastFor = this.average < this.o.fastMs ? this.fastFor + frameMs : 0;

    if (this.slowFor >= this.o.dropAfterMs && this.scale > this.o.min) {
      this.scale = Math.max(this.o.min, round(this.scale - this.o.dropStep));
      this.slowFor = 0;
      this.fastFor = 0;
      this.sinceDrop = 0;
      // The old average described the old resolution.
      this.average = 0;
      return this.scale;
    }
    if (this.fastFor >= this.o.riseAfterMs && this.sinceDrop >= this.o.cooldownMs && this.scale < 1) {
      this.scale = Math.min(1, round(this.scale + this.o.riseStep));
      this.fastFor = 0;
      this.average = 0;
      return this.scale;
    }
    return null;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
