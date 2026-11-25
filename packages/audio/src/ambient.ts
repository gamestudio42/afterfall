/**
 * The ambient planner: what the world sounds like around the listener, from moment to
 * moment, and nothing about how it is played.
 *
 * The world is not dead; the civilisation is. The planner keeps three things going:
 *
 * - The dead, heard before they are seen: a moan or a groan from one of them close by, feet
 *   dragging when they are very close, and a crowd of moans that swells as more come within
 *   earshot. Rain covers some of it.
 * - The day's curve: a dawn chorus, crows at dusk, crickets from dusk to dawn, an owl and a
 *   cracking twig at night, and now and then a stretch of near silence, longer and more
 *   often at night, so that the next sound counts.
 * - The city far off: a gate creaking, a sign clanging, a can rolling, a fence shaking, once
 *   in a long while a car alarm; never on a beat, each from its own direction and distance,
 *   chosen by what kind of district lies round the listener.
 *
 * Pure and seeded: no WebAudio, no clock but the `dt` it is given, so it is tested in Node.
 * The game feeds it every frame and plays what it returns.
 */

import type { SoundscapeLevels } from "./sounds";

export interface AmbientInput {
  /** Hour of the day, 0 to 24. */
  hour: number;
  /** 0 at night, 1 in full day. */
  daylight: number;
  rain: number;
  cloud: number;
  /** How much open water lies round the listener, 0 to 1. */
  water: number;
  /** The share of each kind of district round the listener (they need not add to 1). */
  zones: { residential: number; commercial: number; industrial: number; park: number };
  /** The infected within earshot, relative to the listener, in metres. */
  infected: readonly { dx: number; dy: number }[];
}

export interface AmbientEvent {
  sound: string;
  dx: number;
  dy: number;
}

export interface AmbientOutput {
  events: AmbientEvent[];
  beds: SoundscapeLevels;
}

/** How far the dead are heard, and how close before their feet are. */
export const MOAN_RANGE = 70;
export const SHUFFLE_RANGE = 22;
/** How many of the dead within 150 m make the crowd bed full. */
const HORDE_FULL = 30;
/** Each of the dead within range moans about this often, in seconds. */
const MOAN_EVERY = 12;

/** A bump centred on `c`, `w` wide on each side, on a 24-hour clock. */
function bell(hour: number, c: number, w: number): number {
  let d = Math.abs(hour - c);
  d = Math.min(d, 24 - d);
  return d >= w ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / w);
}

/** 1 through the night, easing in from dusk and out at dawn. */
function nightCurve(hour: number): number {
  if (hour >= 20 || hour < 4.5) return 1;
  if (hour >= 18) return (hour - 18) / 2;
  if (hour < 6) return 1 - (hour - 4.5) / 1.5;
  return 0;
}

export class AmbientPlanner {
  private state: number;
  /** Seconds of near silence left, and until the next one may start. */
  private hush = 0;
  private untilHush: number;

  constructor(seed = 1) {
    this.state = (seed * 2654435761) >>> 0;
    this.untilHush = 60 + this.rand() * 120;
  }

  private rand(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Whether an event that happens `rate` times a second on average happens in this frame. */
  private chance(rate: number, dt: number): boolean {
    return rate > 0 && this.rand() < 1 - Math.exp(-rate * dt);
  }

  /** A point a random way round the listener, between two distances. */
  private around(near: number, farOff: number): { dx: number; dy: number } {
    const a = this.rand() * Math.PI * 2;
    const d = near + this.rand() * (farOff - near);
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d };
  }

  /** Whether the world is holding its breath: ambient events wait and the beds sink. */
  get silent(): boolean {
    return this.hush > 0;
  }

  update(dt: number, w: AmbientInput): AmbientOutput {
    const events: AmbientEvent[] = [];
    const night = nightCurve(w.hour);
    const dry = 1 - Math.min(1, w.rain);

    // Near silence: more often and longer at night.
    if (this.hush > 0) this.hush -= dt;
    else if ((this.untilHush -= dt) <= 0) {
      this.hush = 15 + this.rand() * (night > 0.5 ? 50 : 25);
      this.untilHush = (night > 0.5 ? 90 : 200) + this.rand() * 150;
    }
    const calm = this.silent ? 0 : 1;

    // The dead. Silence never stops them: they are what breaks it.
    let near = 0;
    for (const z of w.infected) {
      const d = Math.hypot(z.dx, z.dy);
      if (d < 150) near++;
      if (d > MOAN_RANGE) continue;
      // Rain covers some of them; the closer, the more of them are heard.
      if (this.chance(((1 - 0.5 * w.rain) * (1.3 - d / MOAN_RANGE)) / MOAN_EVERY, dt))
        events.push({ sound: this.rand() < 0.3 ? "groan" : "moan", dx: z.dx, dy: z.dy });
      if (d < SHUFFLE_RANGE && this.chance(1 / 9, dt)) events.push({ sound: "shuffle", dx: z.dx, dy: z.dy });
    }
    const horde = Math.max(0, Math.min(1, (near - 3) / (HORDE_FULL - 3))) * (1 - 0.4 * w.rain);

    // The day's curve.
    const dawn = bell(w.hour, 6.3, 1.3);
    const dusk = bell(w.hour, 18.2, 1);
    if (calm && dry > 0.2) {
      if (this.chance(0.7 * dawn * dry, dt)) events.push({ sound: "chirp", ...this.around(30, 110) });
      if (this.chance(0.07 * dusk * dry + 0.01 * w.daylight, dt)) events.push({ sound: "caw", ...this.around(50, 160) });
    }
    if (calm && night > 0.6) {
      if (this.chance(0.018 * dry, dt)) events.push({ sound: "owl", ...this.around(60, 150) });
      if (this.chance(0.012 + 0.02 * w.zones.park, dt)) events.push({ sound: "snap", ...this.around(20, 70) });
    }

    // The city far off, by district, and more of it when the wind is up.
    if (calm) {
      const z = w.zones;
      const rate = (0.04 + 0.04 * w.cloud) * (1 - 0.5 * z.park);
      if (this.chance(rate, dt)) {
        const weights: [string, number][] = [
          ["creak", 1 + 3 * z.residential + 2 * z.industrial],
          ["fence", 0.5 + 2 * z.residential + 1 * z.industrial],
          ["can", 0.5 + 3 * z.commercial],
          ["clang", 0.5 + 2 * z.commercial + 4 * z.industrial],
          ["alarm", 0.04 + 0.08 * z.commercial],
        ];
        const total = weights.reduce((s, [, v]) => s + v, 0);
        let pick = this.rand() * total;
        for (const [sound, v] of weights) {
          if ((pick -= v) > 0) continue;
          events.push({ sound, ...this.around(sound === "alarm" ? 150 : 60, sound === "alarm" ? 300 : 190) });
          break;
        }
      }
    }

    const sink = this.silent ? 0.3 : 1;
    return {
      events,
      beds: {
        crickets: night * (1 - 0.8 * w.rain) * sink,
        frogs: night * w.water * sink,
        wind: (0.3 + 0.5 * w.cloud) * (this.silent ? 0.6 : 1),
        rain: w.rain,
        horde,
      },
    };
  }
}
