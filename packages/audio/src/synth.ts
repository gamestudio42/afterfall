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
export type SynthSound = "chirp" | "caw" | "flutter" | "bark" | "squeak";
/** Looping beds, mixed by the soundscape. */
export type SynthBed = "crickets" | "frogs" | "wind" | "rain";

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

/** A house sparrow's call: three to four short notes, each a quick sweep near 4 kHz. */
function chirp(r: () => number): Float32Array {
  const out = buffer(0.6);
  let t0 = 0.01;
  const notes = 3 + Math.floor(r() * 2);
  for (let n = 0; n < notes; n++) {
    const len = 0.05 + r() * 0.05;
    const f0 = 3000 + r() * 1400;
    const sweep = (r() - 0.4) * 2600;
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      phase += (2 * Math.PI * (f0 + sweep * k)) / SYNTH_RATE;
      const env = Math.min(1, t / 0.004) * Math.pow(1 - k, 1.5);
      const at = Math.round(t0 * SYNTH_RATE) + i;
      if (at < out.length) out[at] += (Math.sin(phase) + 0.25 * Math.sin(phase * 2)) * env;
    }
    t0 += len + 0.03 + r() * 0.06;
  }
  return normalize(out, 0.8);
}

/** A crow: two hoarse caws, a buzzing tone through the throat's resonance. */
function caw(r: () => number): Float32Array {
  const out = buffer(0.95);
  for (let c = 0; c < 2; c++) {
    const start = 0.02 + c * 0.42;
    const len = 0.3;
    const f = 470 - c * 30;
    let phase = 0;
    for (let i = 0; i < len * SYNTH_RATE; i++) {
      const t = i / SYNTH_RATE;
      const k = t / len;
      phase += (2 * Math.PI * (f * (1 - 0.12 * k) * (1 + 0.02 * Math.sin(t * 2 * Math.PI * 28)))) / SYNTH_RATE;
      let v = 0;
      for (let h = 1; h <= 10; h++) v += Math.sin(phase * h) / h;
      v += (r() * 2 - 1) * 0.6;
      const env = Math.min(1, t / 0.02) * Math.pow(1 - k, 0.8);
      out[Math.round(start * SYNTH_RATE) + i] += v * env;
    }
  }
  return normalize(bandpass(out, 1300, 1.2), 0.85);
}

/** A flock lifting off: a run of soft wing beats in filtered noise. */
function flutter(r: () => number): Float32Array {
  const out = buffer(0.9);
  const rate = 16 + r() * 6;
  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    const beat = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t + Math.sin(t * 7) * 2), 3);
    out[i] = (r() * 2 - 1) * beat * Math.min(1, t / 0.03) * Math.exp(-t * 3.2);
  }
  return normalize(lowpass(bandpass(out, 900, 0.6), 3000), 0.8);
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
  return normalize(mixed, 0.9);
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

/** Rain: a hiss of fine drops, and now and then a heavier one on metal. */
function rain(r: () => number): Float32Array {
  const raw = buffer(5);
  for (let i = 0; i < raw.length; i++) raw[i] = r() * 2 - 1;
  const hiss = bandpass(raw, 3500, 0.5);
  for (let n = 0; n < 40; n++) {
    const at = Math.floor(r() * (raw.length - 400));
    const f = 1800 + r() * 2500;
    for (let i = 0; i < 300; i++) hiss[at + i] += Math.sin((2 * Math.PI * f * i) / SYNTH_RATE) * Math.exp(-i / 60) * 0.6;
  }
  return normalize(seamless(hiss, 1), 0.5);
}

const MAKERS: Record<SynthSound, (r: () => number) => Float32Array> = { chirp, caw, flutter, bark, squeak };

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
  return rain(r);
}
