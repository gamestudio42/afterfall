import { describe, expect, it } from "vitest";
import { AudioDirector, AMBIENCE, SOUNDS, soundForAlert, soundForFx, spatial, type FxEvent } from "../src";

/** Contexto de audio falso: conta as vozes sem tocar nada. */
class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  detune = new FakeParam();
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext {
  currentTime = 0;
  destination = new FakeNode();
  state = "running";
  sources: FakeSource[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];

  createGain(): FakeNode & { gain: FakeParam } {
    const node = new FakeNode() as FakeNode & { gain: FakeParam };
    node.gain = new FakeParam();
    this.gains.push(node);
    return node;
  }

  createStereoPanner(): FakeNode & { pan: FakeParam } {
    const node = new FakeNode() as FakeNode & { pan: FakeParam };
    node.pan = new FakeParam();
    return node;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    this.state = "running";
  }
}

function director(): { ctx: FakeContext; audio: AudioDirector } {
  const ctx = new FakeContext();
  const audio = new AudioDirector(ctx as unknown as BaseAudioContext, { range: 600 });
  const buffers: Record<string, AudioBuffer> = {};
  for (const spec of Object.values(SOUNDS)) buffers[spec.file] = {} as AudioBuffer;
  for (const bed of Object.values(AMBIENCE as Record<string, { file: string }>)) buffers[bed.file] = {} as AudioBuffer;
  audio.setBuffers(buffers);
  return { ctx, audio };
}

function fx(seq: number, type: string, x = 0, y = 0): FxEvent {
  return { seq, type, x, y };
}

describe("sound mapping", () => {
  it("covers every simulation effect", () => {
    for (const type of ["shot", "melee", "hit", "death", "build"]) {
      expect(soundForFx(type)).not.toBeNull();
      expect(SOUNDS[soundForFx(type)!]).toBeDefined();
    }
    expect(soundForFx("unknown")).toBeNull();
  });

  it("keeps noise silent, because its shot already plays", () => {
    expect(soundForFx("noise")).toBeNull();
  });

  it("leaves a collapse to the sound of its alert", () => {
    expect(soundForFx("collapse")).toBeNull();
    expect(soundForAlert("alert.structureDestroyed")).not.toBeNull();
  });

  it("maps the alerts that have a sound and ignores the text ones", () => {
    expect(soundForAlert("alert.hordeDetected")).toBe("horde");
    expect(soundForAlert("alert.dawn")).toBe("dawn");
    expect(soundForAlert("alert.defeat")).toBe("defeat");
    expect(soundForAlert("alert.cacheFound")).toBeNull();
  });

  it("attenuates with distance and keeps pan inside -1..1", () => {
    const perto = spatial(0, 0, 600);
    expect(perto.gain).toBeCloseTo(1);
    expect(perto.pan).toBeCloseTo(0);

    const longe = spatial(600, 0, 600);
    expect(longe.gain).toBeCloseTo(0);

    expect(spatial(300, 0, 600).pan).toBeGreaterThan(0.5);
    expect(spatial(-300, 0, 600).pan).toBeLessThan(-0.5);
    expect(spatial(9999, 0, 600).pan).toBe(1);
  });
});

describe("director", () => {
  it("plays each new effect once and never repeats what already passed", () => {
    const { ctx, audio } = director();
    const view = { fx: [fx(1, "shot"), fx(2, "hit")], alerts: [], listener: { x: 0, y: 0 } };
    audio.update(view);
    expect(ctx.sources.length).toBe(2);
    audio.update(view);
    expect(ctx.sources.length).toBe(2);
    expect(audio.stats.total).toBe(2);
  });

  it("respects the minimum interval between shots of the same sound", () => {
    const { ctx, audio } = director();
    audio.update({ fx: [fx(1, "shot")], alerts: [], listener: { x: 0, y: 0 } });
    audio.update({ fx: [fx(1, "shot"), fx(2, "shot")], alerts: [], listener: { x: 0, y: 0 } });
    expect(ctx.sources.length).toBe(1);
    expect(audio.stats.dropped.shot).toBe(1);

    ctx.currentTime = 0.1; // 100 ms depois
    audio.update({ fx: [fx(1, "shot"), fx(2, "shot"), fx(3, "shot")], alerts: [], listener: { x: 0, y: 0 } });
    expect(ctx.sources.length).toBe(2);
  });

  it("respects the voice cap per sound", () => {
    const { ctx, audio } = director();
    let seq = 0;
    for (let i = 0; i < 10; i++) {
      ctx.currentTime += 0.1;
      audio.update({ fx: [fx(++seq, "hit")], alerts: [], listener: { x: 0, y: 0 } });
    }
    expect(ctx.sources.length).toBe(SOUNDS.hit.maxVoices);
    expect(audio.stats.played.hit).toBe(SOUNDS.hit.maxVoices);
  });

  it("does not play what happened too far away", () => {
    const { ctx, audio } = director();
    audio.update({ fx: [fx(1, "shot", 5000, 5000)], alerts: [], listener: { x: 0, y: 0 } });
    expect(ctx.sources.length).toBe(0);
  });

  it("plays the horde alert as a non positional sound", () => {
    const { ctx, audio } = director();
    audio.update({
      fx: [],
      alerts: [
        { id: 10, key: "alert.cacheFound" },
        { id: 11, key: "alert.hordeDetected" },
      ],
      listener: { x: 0, y: 0 },
    });
    expect(ctx.sources.length).toBe(1);
    expect(audio.stats.played.horde).toBe(1);
  });

  it("does not dump a large backlog of events at once", () => {
    const { ctx, audio } = director();
    const backlog = Array.from({ length: 200 }, (_, i) => fx(i + 1, "hit"));
    audio.update({ fx: backlog, alerts: [], listener: { x: 0, y: 0 } });
    expect(ctx.sources.length).toBeLessThanOrEqual(8);
    expect(audio.stats.dropped.__catchup).toBeGreaterThan(0);
  });
});

describe("volume, mute and ambience", () => {
  it("applies volume to the master gain and mutes without losing the value", () => {
    const { ctx, audio } = director();
    audio.setVolume(0.5);
    expect(audio.stats.volume).toBe(0.5);

    audio.setMuted(true);
    expect(audio.stats.muted).toBe(true);

    audio.setMuted(false);
    expect(audio.stats.muted).toBe(false);
    // The master gain is the first node created in the constructor.
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.5);
  });

  it("clamps volume to 0..1", () => {
    const { audio } = director();
    audio.setVolume(4);
    expect(audio.stats.volume).toBe(1);
    audio.setVolume(-2);
    expect(audio.stats.volume).toBe(0);
  });

  it("switches the ambience bed only when half of the day changes", () => {
    const { ctx, audio } = director();
    audio.setAmbience("day");
    expect(audio.stats.ambience).toBe("day");
    expect(ctx.sources[ctx.sources.length - 1].loop).toBe(true);

    audio.setAmbience("day");
    expect(ctx.sources.length).toBe(1);

    audio.setAmbience("dusk");
    expect(audio.stats.ambience).toBe("night");
    expect(ctx.sources.length).toBe(2);
    // The day bed was scheduled to stop after the crossfade.
    expect(ctx.sources[0].stopped).toBe(true);
  });

  it("does not play ambience when the phase has no bed", () => {
    const { ctx, audio } = director();
    audio.setAmbience("unknown");
    expect(audio.stats.ambience).toBeNull();
    expect(ctx.sources.length).toBe(0);
  });
});
