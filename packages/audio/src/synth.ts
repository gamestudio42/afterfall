/**
 * The city's wildlife and weather, synthesized: a sparrow's chirp, a crow's caw, a flock
 * lifting off, a stray's bark, a rat's squeak, and the beds under them (crickets, frogs,
 * wind, rain).
 *
 * Pure and seeded: plain sample arrays, no WebAudio, so the same seed always gives the
 * same sound and it can be tested in Node. The director turns them into buffers. There is
 * no recorded or third-party audio here, and nothing to license: SoundCraft cannot bounce
 * headlessly yet, and these are simple enough to make from oscillators and noise.
 */

export const SYNTH_RATE = 22050;

/** One-shot sounds, played where something happened. */
export type SynthSound =
  | "chirp"
  | "caw"
  | "flutter"
  | "bark"
  | "squeak"
  | "moan"
  | "groan"
  | "shuffle"
  | "owl"
  | "snap"
  | "creak"
  | "clang"
  | "can"
  | "fence"
  | "alarm";
/** Looping beds, mixed by the soundscape. */
export type SynthBed = "crickets" | "frogs" | "wind" | "rain" | "horde";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A two-pole band-pass filter (RBJ), run over a buffer in place. */
function bandpass(x: Float32Array, freq: number, q: number): Float32Array {
  const w = (2 * Math.PI * freq) / SYNTH_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** A one-pole low-pass. */
function lowpass(x: Float32Array, freq: number): Float32Array {
  const k = 1 - Math.exp((-2 * Math.PI * freq) / SYNTH_RATE);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) out[i] = y += k * (x[i] - y);
  return out;
}

/** Scales a buffer so its loudest sample is `peak`. */
function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SYNTH_RATE));
}

/** A one-pole high-pass. */
function highpass(x: Float32Array, freq: number): Float32Array {
  const lo = lowpass(x, freq);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - lo[i];
  return out;
}

/**
 * A small courtyard's reverb (Schroeder: four combs, two all-passes), mixed under the dry
 * sound and given a tail. A dry synthesized call sounds like a beep from a speaker; heard
 * off walls it sounds like something out there in the street.
 */
function room(x: Float32Array, mix: number, tail = 0.6): Float32Array {
  const n = x.length + Math.round(tail * SYNTH_RATE);
  const dry = new Float32Array(n);
  dry.set(x);
  const wet = new Float32Array(n);
  for (const [ms, fb] of [
    [29.7, 0.78],
    [37.1, 0.76],
    [41.1, 0.74],
    [43.7, 0.72],
  ]) {
    const d = Math.round((ms / 1000) * SYNTH_RATE);
    const line = new Float32Array(n);
    let damp = 0;
    for (let i = 0; i < n; i++) {
      const back = i >= d ? line[i - d] : 0;
      damp += 0.45 * (back - damp);
      line[i] = dry[i] + damp * fb;
      wet[i] += back * 0.25;
    }
  }
  let y = wet;
  for (const ms of [5, 1.7]) {
    const d = Math.round((ms / 1000) * SYNTH_RATE);
    const g = 0.7;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const back = i >= d ? out[i - d] : 0;
      const inBack = i >= d ? y[i - d] : 0;
      out[i] = -g * y[i] + inBack + g * back;
    }
    y = out;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dry[i] * (1 - mix) + y[i] * mix;
  return out;
}

/**
 * A sparrow's call: two to four short notes, most of them a fast fall from about 7 kHz to
 * 3.5 kHz, some a rising "tsip", a few trilled; each with its overtones and a breath of
 * noise, softened as if heard from across the street and set in a small room's reverb.
 */
function chirp(r: () => number): Float32Array {
  const out = buffer(0.7);
  let t0 = 0.01;
  const notes = 2 + Math.floor(r() * 3);
  for (let n = 0; n < notes; n++) {
    const len = 0.045 + r() * 0.05;
    const rising = r() < 0.3;
    const f0 = rising ? 2600 + r() * 800 : 6200 + r() * 1400;
    const f1 = rising ? 5000 + r() * 1200 : 2900 + r() * 900;
    const trill = r() < 0.35 ? 0.06 : 0;
    const trillRate = 40 + r() * 25;
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      const f = f0 * Math.exp(Math.log(f1 / f0) * k) * (1 + trill * Math.sin(2 * Math.PI * trillRate * t));
      phase += (2 * Math.PI * f) / SYNTH_RATE;
      const env = Math.min(1, t / 0.003) * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.15)), 0.6);
      const voice = Math.sin(phase) + 0.35 * Math.sin(phase * 2) + 0.1 * Math.sin(phase * 3) + (r() * 2 - 1) * 0.08;
      const at = Math.round(t0 * SYNTH_RATE) + i;
      if (at < out.length) out[at] += voice * env;
    }
    t0 += len + 0.025 + r() * 0.07;
  }
  return normalize(room(lowpass(bandpass(out, 4200, 0.45), 6500), 0.3, 0.5), 0.8);
}

/**
 * A crow: two or three hoarse caws. A throat's buzz (a pulse train whose period wavers
 * from cycle to cycle, which is what makes it rasp) shaped by three resonances, with
 * breath noise through the same resonances, in a room's reverb.
 */
function caw(r: () => number): Float32Array {
  const caws = 2 + Math.floor(r() * 2);
  const out = buffer(0.4 * caws + 0.1);
  for (let c = 0; c < caws; c++) {
    const start = Math.round((0.02 + c * (0.36 + r() * 0.06)) * SYNTH_RATE);
    const len = 0.26 + r() * 0.08;
    const f0 = 300 - c * 15 + r() * 30;
    let next = 0;
    let pulse = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      if (i >= next) {
        // Each period jitters by a few percent: the rasp.
        const period = SYNTH_RATE / (f0 * (1 - 0.15 * k) * (1 + (r() - 0.5) * 0.09));
        next = i + period;
        pulse = 0.8 + r() * 0.4;
      }
      const glottal = pulse * Math.exp(-(i - (next - SYNTH_RATE / f0)) / 18);
      pulse *= 0.995;
      const env = Math.min(1, t / 0.025) * Math.pow(1 - k, 0.7);
      out[start + i] += (glottal + (r() * 2 - 1) * 0.35) * env;
    }
  }
  const f1 = bandpass(out, 650, 3);
  const f2 = bandpass(out, 1250, 4);
  const f3 = bandpass(out, 2600, 5);
  const voiced = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) voiced[i] = f1[i] + f2[i] * 0.8 + f3[i] * 0.35;
  return normalize(room(voiced, 0.35, 0.7), 0.85);
}

/** A flock lifting off: a scatter of soft wing claps, three birds out of step. */
function flutter(r: () => number): Float32Array {
  const out = buffer(1);
  for (let bird = 0; bird < 4; bird++) {
    let t = bird * 0.03 + r() * 0.05;
    const rate = 11 + r() * 7;
    while (t < 0.85) {
      const at = Math.round(t * SYNTH_RATE);
      const len = Math.round((0.018 + r() * 0.012) * SYNTH_RATE);
      const gain = (0.6 + r() * 0.4) * Math.exp(-t * 2.4);
      for (let i = 0; i < len && at + i < out.length; i++) out[at + i] += (r() * 2 - 1) * gain * Math.sin((Math.PI * i) / len);
      t += (1 / rate) * (0.85 + r() * 0.3);
    }
  }
  return normalize(room(lowpass(highpass(out, 250), 2200), 0.25, 0.4), 0.8);
}

/** A stray's bark: two short, falling barks, a voice through two mouth resonances. */
function bark(r: () => number): Float32Array {
  const out = buffer(0.62);
  for (let b = 0; b < 2; b++) {
    const start = 0.01 + b * 0.27;
    const len = 0.17 - b * 0.02;
    const f0 = 430 - b * 50 + r() * 40;
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      phase += (2 * Math.PI * f0 * (1 - 0.38 * k)) / SYNTH_RATE;
      let v = 0;
      for (let h = 1; h <= 14; h++) v += Math.sin(phase * h) / Math.pow(h, 0.9);
      v += (r() * 2 - 1) * 1.2;
      const env = Math.min(1, t / 0.006) * Math.exp(-k * 3.2);
      out[Math.round(start * SYNTH_RATE) + i] += v * env;
    }
  }
  const mouth = bandpass(out, 850, 2.2);
  const nose = bandpass(out, 2100, 3);
  const mixed = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) mixed[i] = mouth[i] + nose[i] * 0.5;
  return normalize(room(mixed, 0.3, 0.6), 0.9);
}

/** A rat: a few thin squeaks. */
function squeak(r: () => number): Float32Array {
  const out = buffer(0.35);
  for (let n = 0; n < 3; n++) {
    const start = 0.01 + n * (0.07 + r() * 0.04);
    const len = 0.035;
    const f0 = 5200 + r() * 1200;
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      phase += (2 * Math.PI * f0 * (1 + 0.15 * Math.sin((t / len) * Math.PI))) / SYNTH_RATE;
      out[Math.round(start * SYNTH_RATE) + i] += Math.sin(phase) * Math.sin((t / len) * Math.PI);
    }
  }
  return normalize(out, 0.6);
}

/**
 * Crickets: three of them, each a 4-5 kHz tone in bursts of three pulses. Their rates are
 * whole cycles in the four-second loop, so it repeats without a seam.
 */
function crickets(): Float32Array {
  const len = 4;
  const out = buffer(len);
  const voices = [
    { f: 4300, rate: 9 / 4, at: 0.1, gain: 1 },
    { f: 4750, rate: 11 / 4, at: 0.37, gain: 0.7 },
    { f: 5150, rate: 2, at: 0.61, gain: 0.5 },
  ];
  for (const v of voices)
    for (let i = 0; i < out.length; i++) {
      const t = i / SYNTH_RATE;
      const cycle = (t * v.rate + v.at) % 1;
      // Three pulses of 12 ms in the first 90 ms of each chirp.
      const inChirp = cycle / v.rate;
      const pulse = inChirp < 0.09 ? Math.max(0, Math.sin(((inChirp % 0.03) / 0.03) * Math.PI)) : 0;
      out[i] += Math.sin(2 * Math.PI * v.f * t) * pulse * v.gain;
    }
  return normalize(out, 0.5);
}

/** Places events round a loop: what runs off the end comes back in at the start. */
function wrapAdd(out: Float32Array, at: number, x: Float32Array): void {
  for (let i = 0; i < x.length; i++) out[(at + i) % out.length] += x[i];
}

/** Frogs: low croaks at uneven times, pulsed in the throat. */
function frogs(r: () => number): Float32Array {
  const out = buffer(6);
  for (let n = 0; n < 9; n++) {
    const len = 0.2 + r() * 0.15;
    const f = 170 + r() * 160;
    const croak = buffer(len);
    for (let i = 0; i < croak.length; i++) {
      const t = i / SYNTH_RATE;
      const pulse = Math.max(0, Math.sin(2 * Math.PI * (22 + r() * 0.5) * t));
      croak[i] = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) * pulse * Math.sin((t / len) * Math.PI);
    }
    wrapAdd(out, Math.floor(r() * out.length), croak);
  }
  return normalize(out, 0.55);
}

/** Crossfades a buffer's last second into its start, so it loops without a click. */
function seamless(x: Float32Array, fade: number): Float32Array {
  const n = Math.round(fade * SYNTH_RATE);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + x[x.length - n + i] * (1 - k);
  }
  return out;
}

/** Wind: brown noise, low-passed, swelling in gusts. */
function wind(r: () => number): Float32Array {
  const raw = buffer(9);
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    brown = (brown + (r() * 2 - 1) * 0.02) * 0.998;
    const t = i / SYNTH_RATE;
    const gust = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / 8) + 0.15 * Math.sin((2 * Math.PI * t) / 2.7 + 1);
    raw[i] = brown * gust;
  }
  return normalize(seamless(lowpass(raw, 500), 1), 0.6);
}

/**
 * Rain: a steady wash, and over it thousands of drops, each a few milliseconds of noise
 * at its own pitch, most of them faint, a few heavier ones ringing on something hollow.
 * Pure tones for the drops sounded like a machine beeping.
 */
function rain(r: () => number): Float32Array {
  const raw = buffer(7);
  for (let i = 0; i < raw.length; i++) raw[i] = r() * 2 - 1;
  // The wash: noise with the hiss and the rumble taken out of it.
  const wash = lowpass(highpass(raw, 400), 4500);
  const drops = new Float32Array(raw.length);
  const count = 7 * 650;
  for (let n = 0; n < count; n++) {
    const at = Math.floor(r() * (raw.length - 400));
    const len = Math.round((0.002 + r() * 0.008) * SYNTH_RATE);
    const gain = Math.pow(r(), 3);
    const tone = 1500 + r() * 5500;
    const burst = new Float32Array(len);
    for (let i = 0; i < len; i++) burst[i] = (r() * 2 - 1) * Math.exp(-i / (len * 0.3));
    const shaped = bandpass(burst, tone, 1.5 + r() * 2);
    for (let i = 0; i < len; i++) drops[at + i] += shaped[i] * gain;
  }
  // Heavier drops off a gutter or a car roof: a noise tap ringing in a narrow band.
  for (let n = 0; n < 30; n++) {
    const at = Math.floor(r() * (raw.length - 2000));
    const tap = new Float32Array(1600);
    for (let i = 0; i < 40; i++) tap[i] = (r() * 2 - 1) * (1 - i / 40);
    const ring = bandpass(tap, 1800 + r() * 2200, 14);
    const gain = 0.6 + r() * 0.8;
    for (let i = 0; i < ring.length; i++) drops[at + i] += ring[i] * gain;
  }
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = wash[i] * 0.35 + drops[i] * 2.2;
  return normalize(seamless(lowpass(out, 7000), 1), 0.5);
}

// ---------------------------------------------------------------------------
// The dead
// ---------------------------------------------------------------------------

/**
 * A voice: a pulse train whose pitch wavers from cycle to cycle (the throat), shaped by
 * three resonances (the mouth's vowel), with breath through the same resonances.
 */
function voice(
  r: () => number,
  seconds: number,
  f0: number,
  glide: number,
  formants: [number, number, number],
  breath: number,
  jitter: number,
): Float32Array {
  const out = buffer(seconds);
  let next = 0;
  let pulse = 0;
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    const k = t / seconds;
    if (i >= next) {
      const f = f0 * (1 + glide * k) * (1 + 0.04 * Math.sin(t * 2 * Math.PI * 4.5)) * (1 + (r() - 0.5) * jitter);
      last = i;
      next = i + SYNTH_RATE / f;
      pulse = 0.7 + r() * 0.6;
    }
    out[i] = pulse * Math.exp(-(i - last) / 25) + (r() * 2 - 1) * breath;
  }
  const [a, b, c] = formants;
  const f1 = bandpass(out, a, 4);
  const f2 = bandpass(out, b, 5);
  const f3 = bandpass(out, c, 6);
  const shaped = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    // Swells in, sags, and dies away: a moan, not a note.
    const env = Math.min(1, t / 0.25) * Math.pow(1 - t / seconds, 0.6) * (0.75 + 0.25 * Math.sin(t * 2 * Math.PI * 0.9));
    shaped[i] = (f1[i] + f2[i] * 0.6 + f3[i] * 0.25) * env;
  }
  return shaped;
}

/** One of the dead, moaning: a long, low "uhhh" that sags in pitch. */
function moan(r: () => number): Float32Array {
  const seconds = 1.3 + r() * 1;
  const v = voice(r, seconds, 95 + r() * 40, -0.25, [420 + r() * 120, 820 + r() * 200, 2400], 0.5, 0.08);
  return normalize(room(lowpass(v, 3000), 0.35, 0.8), 0.85);
}

/** A short, wet groan, rougher than a moan. */
function groan(r: () => number): Float32Array {
  const seconds = 0.5 + r() * 0.35;
  const v = voice(r, seconds, 75 + r() * 25, -0.35, [380, 700 + r() * 150, 2200], 0.9, 0.15);
  return normalize(room(lowpass(v, 2500), 0.3, 0.6), 0.85);
}

/** Feet dragging on grit: three to five slow scuffs. */
function shuffle(r: () => number): Float32Array {
  const out = buffer(2.4);
  let t = 0.05;
  const steps = 3 + Math.floor(r() * 3);
  for (let n = 0; n < steps; n++) {
    const len = 0.16 + r() * 0.12;
    const at = Math.round(t * SYNTH_RATE);
    for (let i = 0; i < len * SYNTH_RATE && at + i < out.length; i++) {
      const k = i / (len * SYNTH_RATE);
      // A scrape swells and fades; grit is noise in short crackles.
      const grit = r() < 0.15 ? 1 : 0.35;
      out[at + i] += (r() * 2 - 1) * grit * Math.sin(Math.PI * Math.pow(k, 0.6));
    }
    t += 0.42 + r() * 0.2;
  }
  return normalize(room(lowpass(highpass(out, 300), 1600), 0.25, 0.4), 0.7);
}

/** Many of the dead at once, out of sight: overlapping moans, a loop of eight seconds. */
function horde(r: () => number): Float32Array {
  const out = buffer(8);
  for (let n = 0; n < 14; n++) wrapAdd(out, Math.floor(r() * out.length), n % 3 ? moan(r) : groan(r));
  return normalize(lowpass(out, 1800), 0.6);
}

// ---------------------------------------------------------------------------
// The night
// ---------------------------------------------------------------------------

/** An owl: "hoo, hoo-hoooo", soft and breathy, in the dark between buildings. */
function owl(r: () => number): Float32Array {
  const out = buffer(2.2);
  const f = 360 + r() * 60;
  const hoots: [number, number][] = [
    [0.05, 0.28],
    [0.55, 0.18],
    [0.8, 0.55],
  ];
  for (const [start, len] of hoots) {
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      phase += (2 * Math.PI * f * (1 - 0.05 * k)) / SYNTH_RATE;
      const env = Math.sin(Math.PI * Math.min(1, k * 1.05)) * Math.min(1, t / 0.04);
      out[Math.round(start * SYNTH_RATE) + i] += (Math.sin(phase) + (r() * 2 - 1) * 0.06) * env;
    }
  }
  return normalize(room(lowpass(out, 1500), 0.45, 1), 0.7);
}

/** A twig or a board cracking underfoot somewhere: two sharp cracks with a woody ring. */
function snap(r: () => number): Float32Array {
  const out = buffer(0.5);
  for (const at of [0.01, 0.04 + r() * 0.05]) {
    const i0 = Math.round(at * SYNTH_RATE);
    for (let i = 0; i < 0.006 * SYNTH_RATE; i++) out[i0 + i] += (r() * 2 - 1) * (1 - i / (0.006 * SYNTH_RATE));
  }
  const wood = bandpass(out, 2200 + r() * 800, 6);
  const mixed = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) mixed[i] = out[i] * 0.6 + wood[i] * 2;
  return normalize(room(lowpass(mixed, 4000), 0.4, 0.6), 0.7);
}

// ---------------------------------------------------------------------------
// The city, far off
// ---------------------------------------------------------------------------

/** Heard from a block or two away: the highs gone, and the street's echo on it. */
function far(x: Float32Array, cutoff = 2600): Float32Array {
  return room(lowpass(x, cutoff), 0.45, 1.2);
}

/** A gate or a door swinging on a rusted hinge: stick-slip, a run of clicks that slides in pitch. */
function creak(r: () => number): Float32Array {
  const seconds = 0.9 + r() * 0.8;
  const out = buffer(seconds);
  const f0 = 25 + r() * 20;
  const f1 = 55 + r() * 40;
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    const k = i / out.length;
    if (i >= next) {
      out[i] = 1;
      next = i + (SYNTH_RATE / (f0 + (f1 - f0) * Math.sin(Math.PI * k * 0.9))) * (1 + (r() - 0.5) * 0.2);
    }
  }
  const a = bandpass(out, 700 + r() * 300, 12);
  const b = bandpass(out, 1500 + r() * 500, 14);
  const mixed = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) mixed[i] = (a[i] + b[i] * 0.6) * Math.sin((Math.PI * i) / out.length);
  return normalize(far(mixed, 3000), 0.75);
}

/** A loose metal sign struck by the wind: inharmonic partials ringing down, and a smaller knock. */
function clang(r: () => number): Float32Array {
  const out = buffer(2.2);
  const f = 170 + r() * 90;
  const partials = [1, 2.76, 5.4, 8.93];
  for (const [at, gain] of [
    [0.01, 1],
    [0.35 + r() * 0.3, 0.45],
  ]) {
    const i0 = Math.round(at * SYNTH_RATE);
    for (let i = 0; i + i0 < out.length; i++) {
      const t = i / SYNTH_RATE;
      let v = 0;
      partials.forEach((p, n) => (v += (Math.sin(2 * Math.PI * f * p * t + n) / (n + 1)) * Math.exp(-t * (2 + n * 1.5))));
      out[i0 + i] += v * gain * Math.min(1, t / 0.002);
    }
  }
  return normalize(far(out), 0.8);
}

/** An empty can rolling and rattling across the asphalt, slowing to a stop. */
function can(r: () => number): Float32Array {
  const out = buffer(1.8);
  let t = 0.02;
  while (t < 1.5) {
    const at = Math.round(t * SYNTH_RATE);
    for (let i = 0; i < 0.004 * SYNTH_RATE; i++) out[at + i] += (r() * 2 - 1) * (1 - t / 1.6);
    t += (0.025 + r() * 0.03) * (1 + t * 1.5);
  }
  const tin = bandpass(out, 3200 + r() * 1200, 5);
  return normalize(far(tin, 4500), 0.6);
}

/** A chain-link fence shaken by the wind: a shimmer of tiny metal clicks. */
function fence(r: () => number): Float32Array {
  const out = buffer(1.2);
  for (let n = 0; n < 260; n++) {
    const t = Math.pow(r(), 0.7) * 1.0;
    const at = Math.round(t * SYNTH_RATE);
    out[at] += (r() * 2 - 1) * (1 - t);
  }
  const a = bandpass(out, 1800 + r() * 600, 8);
  const b = bandpass(out, 3400 + r() * 800, 8);
  const mixed = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) mixed[i] = a[i] + b[i];
  return normalize(far(mixed, 4000), 0.6);
}

/** A car alarm going off streets away, its battery nearly dead. */
function alarm(r: () => number): Float32Array {
  const out = buffer(3.5);
  const lo = 760 + r() * 80;
  const hi = lo * 1.35;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    const f = Math.floor(t * 4) % 2 ? hi : lo;
    phase += (2 * Math.PI * f) / SYNTH_RATE;
    // A square-ish horn, sagging as the battery gives.
    out[i] = Math.tanh(Math.sin(phase) * 3) * Math.min(1, t / 0.05) * (1 - t / 4);
  }
  return normalize(far(out, 1800), 0.6);
}

const MAKERS: Record<SynthSound, (r: () => number) => Float32Array> = {
  chirp,
  caw,
  flutter,
  bark,
  squeak,
  moan,
  groan,
  shuffle,
  owl,
  snap,
  creak,
  clang,
  can,
  fence,
  alarm,
};

/** The samples of a one-shot sound, the same for the same seed. */
export function synthSound(name: SynthSound, seed = 1): Float32Array {
  return MAKERS[name](rng(seed * 7919 + name.length));
}

/** The samples of a looping bed. */
export function synthBed(name: SynthBed, seed = 1): Float32Array {
  const r = rng(seed * 104729 + name.length);
  if (name === "crickets") return crickets();
  if (name === "frogs") return frogs(r);
  if (name === "wind") return wind(r);
  if (name === "horde") return horde(r);
  return rain(r);
}
