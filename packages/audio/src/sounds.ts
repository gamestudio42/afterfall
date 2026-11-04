/**
 * AFTERFALL sound: the sound table and the event -> sound mapping.
 *
 * Deliberately pure: no WebAudio, DOM or Three here, so it can be tested in
 * Node and reused by tools (headless-run, sweep) and by the interface. The
 * director (director.ts) is what actually plays.
 */

export type FxKind = "shot" | "melee" | "hit" | "death" | "noise" | "build";

/** O que a simulacao publica em `sim.fx` (subconjunto estrutural de core). */
export interface FxEvent {
  seq: number;
  type: string;
  x: number;
  y: number;
}

/** O que a simulacao publica em `sim.state.alerts`. */
export interface AlertEvent {
  id: number;
  key: string;
}

export interface SoundSpec {
  /** Arquivo em `public/sfx`. */
  file: string;
  gain: number;
  /** Vozes simultaneas deste som. */
  maxVoices: number;
  /** Intervalo minimo entre dois disparos do mesmo som. */
  minGapMs: number;
  /** Variacao aleatoria de altura, em cents. */
  detune: number;
}

export const SOUNDS: Record<string, SoundSpec> = {
  shot: { file: "shot.wav", gain: 0.9, maxVoices: 6, minGapMs: 35, detune: 90 },
  melee: { file: "melee.wav", gain: 0.8, maxVoices: 5, minGapMs: 40, detune: 120 },
  hit: { file: "hit.wav", gain: 0.75, maxVoices: 6, minGapMs: 30, detune: 140 },
  death: { file: "death.wav", gain: 0.85, maxVoices: 4, minGapMs: 60, detune: 80 },
  noise: { file: "noise.wav", gain: 0.55, maxVoices: 3, minGapMs: 90, detune: 60 },
  build: { file: "build.wav", gain: 0.8, maxVoices: 4, minGapMs: 50, detune: 100 },
  horde: { file: "alert_horde.wav", gain: 0.95, maxVoices: 1, minGapMs: 4000, detune: 0 },
  dawn: { file: "alert_dawn.wav", gain: 0.7, maxVoices: 1, minGapMs: 2000, detune: 0 },
  defeat: { file: "death.wav", gain: 0.9, maxVoices: 1, minGapMs: 3000, detune: 0 },
  ui: { file: "ui_click.wav", gain: 0.5, maxVoices: 2, minGapMs: 40, detune: 0 },
};

const FX_SOUND: Record<string, string> = {
  shot: "shot",
  melee: "melee",
  hit: "hit",
  death: "death",
  noise: "noise",
  build: "build",
};

const ALERT_SOUND: Record<string, string> = {
  "alert.hordeDetected": "horde",
  "alert.dawn": "dawn",
  "alert.victory": "dawn",
  "alert.defeat": "defeat",
  "alert.bitten": "hit",
  "alert.constructionComplete": "build",
  "alert.structureDestroyed": "build",
};

/** Som de um efeito da simulacao, ou null quando ele nao faz barulho. */
export function soundForFx(type: string): string | null {
  return FX_SOUND[type] ?? null;
}

/** Som de um alerta (chaves de `packages/core`), ou null quando e so texto. */
export function soundForAlert(key: string): string | null {
  return ALERT_SOUND[key] ?? null;
}

export interface Placed {
  gain: number;
  pan: number;
}

/** Camas de ambiencia, uma por metade do dia. Tocam em loop sob os efeitos. */
export const AMBIENCE: Record<string, { file: string; gain: number }> = {
  day: { file: "ambience_day.wav", gain: 0.35 },
  night: { file: "ambience_night.wav", gain: 0.45 },
};

/** Fase do relogio da simulacao -> cama de ambiencia. */
export function ambienceForPhase(phase: string): "day" | "night" | null {
  if (phase === "night" || phase === "dusk") return "night";
  if (phase === "day" || phase === "dawn") return "day";
  return null;
}

/**
 * Distance gain and stereo from the position relative to the screen centre.
 * `range` is the reach in world units: beyond it the sound fades out.
 */
export function spatial(dx: number, dy: number, range: number): Placed {
  const dist = Math.hypot(dx, dy);
  const near = Math.max(0, 1 - dist / Math.max(1, range));
  return {
    gain: near * near,
    pan: Math.max(-1, Math.min(1, dx / Math.max(1, range * 0.55))),
  };
}
