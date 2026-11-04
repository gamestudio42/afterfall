/**
 * Audio director: consumes what the simulation publishes (`sim.fx` and
 * `sim.state.alerts`) and plays the sounds in the table, with a voice cap, a
 * minimum interval per sound and distance attenuation.
 *
 * Works with AudioContext and with OfflineAudioContext: nothing here depends
 * on `window`, `document` or the browser clock — only on `ctx.currentTime`.
 */

import { AMBIENCE, SOUNDS, ambienceForPhase, soundForAlert, soundForFx, spatial, type AlertEvent, type FxEvent } from "./sounds";

export interface DirectorOptions {
  /** Prefixo dos arquivos, normalmente `import.meta.env.BASE_URL`. */
  baseUrl?: string;
  /** Volume geral, 0..1. */
  master?: number;
  /** Alcance espacial em unidades do mundo. */
  range?: number;
  /** Teto global de vozes simultaneas. */
  maxVoices?: number;
}

export interface DirectorView {
  fx: readonly FxEvent[];
  alerts: readonly AlertEvent[];
  listener: { x: number; y: number };
}

export interface DirectorStats {
  state: string;
  loaded: number;
  failed: number;
  total: number;
  played: Record<string, number>;
  dropped: Record<string, number>;
  voices: number;
  volume: number;
  muted: boolean;
  ambience: string | null;
}

/** Um evento esquecido (jogo pausado, aba em segundo plano): nao despeja o atraso todo de uma vez. */
const MAX_CATCHUP = 24;
/** Teto de eventos novos processados por quadro, para nunca travar o frame. */
const MAX_PER_UPDATE = 8;

export class AudioDirector {
  private readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  private readonly range: number;
  private readonly maxVoices: number;
  private readonly baseUrl: string;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastGap = new Map<string, number>();
  private readonly voices = new Map<string, number>();
  private lastFx = 0;
  private lastAlertId = -1;
  private voicesTotal = 0;
  private failed = 0;
  private readonly counts: Record<string, number> = {};
  private readonly drops: Record<string, number> = {};
  private volume: number;
  private muted = false;
  private ambienceName: string | null = null;
  private readonly beds = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  constructor(ctx: BaseAudioContext, options: DirectorOptions = {}) {
    this.ctx = ctx;
    this.baseUrl = options.baseUrl ?? "";
    this.range = options.range ?? 650;
    this.maxVoices = options.maxVoices ?? 24;
    this.master = ctx.createGain();
    this.volume = options.master ?? 0.8;
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
  }

  /** Carrega e decodifica todos os sons da tabela e as camas de ambiencia. */
  async load(): Promise<void> {
    const files = [...new Set([...Object.values(SOUNDS).map((s) => s.file), ...Object.values(AMBIENCE).map((a) => a.file)])];
    await Promise.all(
      files.map(async (file) => {
        try {
          const response = await fetch(this.url(file));
          if (!response.ok) throw new Error(String(response.status));
          const data = await response.arrayBuffer();
          const buffer = await this.ctx.decodeAudioData(data);
          this.buffers.set(file, buffer);
        } catch {
          this.failed += 1;
        }
      }),
    );
  }

  /** Injeta buffers prontos (testes e render offline). */
  setBuffers(buffers: Record<string, AudioBuffer>): void {
    for (const [file, buffer] of Object.entries(buffers)) this.buffers.set(file, buffer);
  }

  /** Retoma o contexto depois de um gesto do jogador. */
  async resume(): Promise<void> {
    const state = (this.ctx as AudioContext).state;
    if (state === "suspended") await (this.ctx as AudioContext).resume();
  }

  /** Volume geral, 0..1 (aplicado na hora, inclusive durante a partida). */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyMaster();
  }

  /** Silencia tudo sem perder o volume escolhido. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /**
   * Switches the ambience bed with the phase of the day, crossfaded.
   * Call it every frame: it only acts when the half of the day changes.
   */
  setAmbience(phase: string): void {
    const want = ambienceForPhase(phase);
    if (want === this.ambienceName) return;
    const now = this.ctx.currentTime;
    const fade = 1.2;

    for (const [name, bed] of this.beds) {
      bed.gain.gain.cancelScheduledValues(now);
      bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
      bed.gain.gain.linearRampToValueAtTime(0, now + fade);
      try {
        bed.src.stop(now + fade + 0.05);
      } catch {
        /* ja parada */
      }
      this.beds.delete(name);
    }

    this.ambienceName = want;
    if (!want) return;
    const spec = AMBIENCE[want];
    const buffer = spec ? this.buffers.get(spec.file) : undefined;
    if (!spec || !buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(spec.gain, now + fade);
    src.connect(gain);
    gain.connect(this.master);
    src.start(now);
    this.beds.set(want, { src, gain });
  }

  /** Le o estado da simulacao e toca so o que apareceu desde o ultimo quadro. */
  update(view: DirectorView): void {
    let fxNew = view.fx.filter((e) => e.seq > this.lastFx);
    if (fxNew.length > MAX_CATCHUP) {
      this.bumpDrops("__catchup", fxNew.length - MAX_CATCHUP);
      fxNew = fxNew.slice(-MAX_CATCHUP);
    }
    if (fxNew.length > MAX_PER_UPDATE) fxNew = fxNew.slice(-MAX_PER_UPDATE);
    if (fxNew.length > 0) this.lastFx = Math.max(this.lastFx, ...fxNew.map((e) => e.seq));

    const alertNew = view.alerts.filter((a) => a.id > this.lastAlertId);
    if (alertNew.length > 0) this.lastAlertId = Math.max(this.lastAlertId, ...alertNew.map((a) => a.id));

    for (const fx of fxNew) {
      const name = soundForFx(fx.type);
      if (!name) continue;
      const { gain, pan } = spatial(fx.x - view.listener.x, fx.y - view.listener.y, this.range);
      if (gain <= 0.02) continue;
      this.play(name, gain, pan);
    }
    for (const alert of alertNew) {
      const name = soundForAlert(alert.key);
      if (name) this.play(name, 1, 0);
    }
  }

  /** Toca um som pelo nome (`SOUNDS`). Retorna se saiu som. */
  play(name: string, gain = 1, pan = 0): boolean {
    const spec = SOUNDS[name];
    if (!spec) return false;
    const buffer = this.buffers.get(spec.file);
    if (!buffer) return false;

    const nowMs = this.ctx.currentTime * 1000;
    const last = this.lastGap.get(name) ?? -Infinity;
    if (nowMs - last < spec.minGapMs) {
      this.bumpDrops(name);
      return false;
    }
    if ((this.voices.get(name) ?? 0) >= spec.maxVoices || this.voicesTotal >= this.maxVoices) {
      this.bumpDrops(name);
      return false;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (spec.detune > 0 && "detune" in source) {
      source.detune.value = (Math.random() - 0.5) * 2 * spec.detune;
    }
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, gain)) * spec.gain;
    const panner = typeof this.ctx.createStereoPanner === "function" ? this.ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(g);
    if (panner) {
      g.connect(panner);
      panner.connect(this.master);
    } else {
      g.connect(this.master);
    }

    this.lastGap.set(name, nowMs);
    this.voices.set(name, (this.voices.get(name) ?? 0) + 1);
    this.voicesTotal += 1;
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    source.onended = () => {
      this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      this.voicesTotal = Math.max(0, this.voicesTotal - 1);
    };
    source.start();
    return true;
  }

  get stats(): DirectorStats {
    return {
      state: (this.ctx as AudioContext).state ?? "unknown",
      loaded: this.buffers.size,
      failed: this.failed,
      total: Object.values(this.counts).reduce((a, b) => a + b, 0),
      played: { ...this.counts },
      dropped: { ...this.drops },
      voices: this.voicesTotal,
      volume: this.volume,
      muted: this.muted,
      ambience: this.ambienceName,
    };
  }

  private applyMaster(): void {
    const target = this.muted ? 0 : this.volume;
    try {
      this.master.gain.setValueAtTime(target, this.ctx.currentTime);
    } catch {
      this.master.gain.value = target;
    }
  }

  private url(file: string): string {
    const base = this.baseUrl.endsWith("/") || this.baseUrl === "" ? this.baseUrl : `${this.baseUrl}/`;
    return `${base}sfx/${file}`;
  }

  private bumpDrops(name: string, count = 1): void {
    this.drops[name] = (this.drops[name] ?? 0) + count;
  }
}
