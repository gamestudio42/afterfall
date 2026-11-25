import { BALANCE, STRUCTURES, type StructureKind } from "@afterfall/content";
import {
  Simulation,
  coversStreet,
  deserialize,
  foldTurn,
  foldYaw,
  isAxial,
  onPaving,
  placementAt,
  placementYaw,
  previewFrame,
  serialize,
  type Command,
  type EntityId,
} from "@afterfall/core";
import { CellKind, generateVariedCity, type CityMap, type CitySize } from "@afterfall/world";
import { GameRenderer, type PostMode, type QualityMode } from "@afterfall/renderer";
import { lineCells } from "@afterfall/shared";
import { putSave } from "../app/saves";
import { useUi, type Speed } from "../app/store";
import { translate } from "../i18n";
import { AudioDirector, type DirectorStats } from "@afterfall/audio";
import { LONG_PRESS_MS, TAP_SLOP, grabPan, pinchFactor, twistDelta } from "./touch";

/** One press of R turns a single wall or gate by this much. */
const ROTATE_STEP = Math.PI / 12;
/** The most pieces one drag draws. */
const LINE_MAX = 200;
const CLICK_SLOP = 5;
const UNIT_PICK_RADIUS = 18;
const EDGE = 10;

/**
 * Glue between browser input, the simulation and the renderer. Owns the
 * main loop. React reads state from here; it never touches the scene.
 */
export class GameController {
  sim: Simulation | null = null;
  readonly renderer: GameRenderer;
  private raf = 0;
  private last = performance.now();
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private leftDown: { x: number; y: number; cell?: [number, number] } | null = null;
  /** The angle the player turned a single wall or gate to with R, for this build mode. */
  private buildYaw: number | null = null;
  private buildYawKind: StructureKind | null = null;
  /** What the build banner shows: how many pieces the preview holds and how they are turned. */
  buildInfo: { count: number; capped: boolean; manual: boolean; steep?: boolean; street?: boolean } | null = null;
  private rightDown: { x: number; y: number; rotating: boolean } | null = null;
  /** Live fingers on the canvas. Mouse and keyboard never write this. */
  private touchPoints = new Map<number, { x: number; y: number }>();
  private touchMode: "pending" | "pan" | "build" | "pinch" | "box" = "pending";
  private touchStart: { x: number; y: number; cell?: [number, number] } = { x: 0, y: 0 };
  private touchLast = { x: 0, y: 0 };
  private touchPinch = { dist: 0, angle: 0, midX: 0, midY: 0 };
  private touchHold = 0;
  private touchToken = 0;
  /** Swallows the click a touch synthesizes, so a tap is not also a mouse click. */
  private ignoreMouse = false;
  private uiTimer = 0;
  private lastDay = 0;
  fps = 60;
  private disposers: (() => void)[] = [];
  private audio: AudioDirector | null = null;
  private audioContext: AudioContext | null = null;
  private audioTried = false;
  private disposed = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new GameRenderer(canvas, {
      baseUrl: import.meta.env.BASE_URL,
      post: initialPost(),
      quality: initialQuality(),
      slowGpu: stored(SLOW_GPU_KEY) ?? "",
    });
    this.bindInput();
    this.resize();
    // The browser only unlocks audio after a gesture: create the context on the first one.
    const unlock = () => void this.ensureAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    this.disposers.push(() => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    });
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /**
   * Starts a game on a generated city, or on an imported real map when one is given. A
   * generated city is drawn by the varied generator: relief, an uneven street plan and,
   * in a valley, a river with its bridges. The classic grid is still there for a player
   * who wants it, and for the browser tests, which place things by its blocks.
   */
  newGame(seed: number, map?: CityMap, style: "varied" | "classic" = "varied", size: CitySize = "medium"): void {
    if (!map && style === "classic") {
      this.attach(new Simulation({ seed }));
      return;
    }
    const city = map ?? generateVariedCity(seed, { size });
    this.attach(new Simulation({ seed: city.seed, map: city }));
  }

  load(data: string): void {
    this.attach(deserialize(data));
  }

  private attach(sim: Simulation): void {
    this.sim = sim;
    this.renderer.setSimulation(sim);
    this.lastDay = sim.clock.day;
    const ui = useUi.getState();
    ui.set({ selectedUnits: [], selectedBuilding: -1, selectedStructure: -1, buildMode: null, speed: 1, lastSpeed: 1, outcomeAck: false });
    if (sim.state.hq >= 0) {
      const e = sim.hqEntrance();
      this.renderer.rts.jumpTo(e.x, e.y);
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __afterfall: GameController }).__afterfall = this;
      // The UI store, so an E2E can select a unit the way the player does.
      (window as unknown as { __afterfallUi: typeof useUi }).__afterfallUi = useUi;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.audio = null;
    this.renderer.dispose();
  }

  command(cmd: Command): void {
    this.sim?.enqueue(cmd);
  }

  async save(name = "manual"): Promise<void> {
    if (!this.sim) return;
    await putSave(name, serialize(this.sim, name));
  }

  setSpeed(speed: Speed): void {
    const ui = useUi.getState();
    ui.set({ speed, lastSpeed: speed === 0 ? ui.lastSpeed : speed });
  }

  togglePause(): void {
    const ui = useUi.getState();
    this.setSpeed(ui.speed === 0 ? ui.lastSpeed || 1 : 0);
  }

  // -------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------

  /**
   * Runs the loop body a fixed number of times with a fixed delta. The E2E specs
   * use it instead of waiting for requestAnimationFrame: a software renderer can
   * take seconds per frame, and a test that waits on frames tests the machine,
   * not the game.
   */
  /** Rolling cost of the three parts of a frame, for the performance probe. */
  readonly cost = { simMs: 0, renderMs: 0, totalMs: 0, frames: 0 };

  step(dtSeconds = 1 / 60, times = 1): void {
    for (let i = 0; i < times; i++) this.frame(dtSeconds * 1000);
  }

  private slowGpuSaved = false;

  /**
   * Once this GPU has fallen to the low tier by itself, the next session starts there
   * instead of spending its first seconds finding out again.
   */
  private rememberSlowGpu(): void {
    const r = this.renderer;
    if (this.slowGpuSaved || r.quality !== "low" || r.qualityChoice !== "auto" || !r.gpuName) return;
    this.slowGpuSaved = true;
    try {
      localStorage.setItem(SLOW_GPU_KEY, r.gpuName);
    } catch {
      /* storage unavailable */
    }
  }

  private frame(fixedDtMs?: number): void {
    const frameStart = performance.now();
    const now = frameStart;
    const dt = Math.min(0.1, (fixedDtMs ?? now - this.last) / 1000);
    // The real interval, not the clamped one: the resolution governor judges the display.
    if (fixedDtMs === undefined && this.renderer) {
      this.renderer.observeFrame(now - this.last);
      this.rememberSlowGpu();
    }
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const ui = useUi.getState();
    if (ui.screen !== "game" || !this.sim) return;
    const sim = this.sim;
    // Leaving build mode forgets the manual angle: the next piece lines itself up again.
    if (!ui.buildMode && (this.buildYaw !== null || this.buildInfo)) {
      this.buildYaw = null;
      this.buildInfo = null;
      this.renderer.buildPreview = null;
    }
    // Hold time while a decision is pending so the player can read it.
    const speed = sim.state.pendingEvent || (sim.state.outcome && sim.state.outcome.type === "defeat") ? 0 : ui.speed;
    const simStart = performance.now();
    sim.update(dt * 1000, speed);
    const simMs = performance.now() - simStart;
    const listener = this.audioListener();
    this.audio?.update({ fx: sim.fx, alerts: sim.state.alerts, listener });
    this.audio?.setAmbience(sim.clock.phase);
    this.updateSoundscape(sim, listener);
    this.updateCamera(dt);
    const r = this.renderer;
    r.selection = { units: ui.selectedUnits, building: ui.selectedBuilding, structure: ui.selectedStructure };
    const renderStart = performance.now();
    r.render(dt);
    const renderMs = performance.now() - renderStart;
    this.cost.simMs += simMs;
    this.cost.renderMs += renderMs;
    this.cost.totalMs += performance.now() - frameStart;
    this.cost.frames += 1;

    this.uiTimer += dt;
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      // Drop dead units from the selection.
      const alive = ui.selectedUnits.filter((id) => sim.state.entities.has(id));
      const patch: Partial<typeof ui> = { frame: ui.frame + 1 };
      if (alive.length !== ui.selectedUnits.length) patch.selectedUnits = alive;
      if (ui.selectedStructure >= 0 && !sim.state.entities.has(ui.selectedStructure)) patch.selectedStructure = -1;
      ui.set(patch);
      r.refreshBuildingColors();
      this.autosave();
    }
  }

  private autosave(): void {
    const sim = this.sim!;
    const c = sim.clock;
    if (c.day !== this.lastDay && c.hour >= 6 && sim.state.started) {
      this.lastDay = c.day;
      void this.save("autosave").catch(() => {
        const ui = useUi.getState();
        ui.set({ toast: translate(ui.lang, "saveFailed") });
      });
    }
  }

  // -------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------

  /** Cria o diretor de audio no primeiro gesto e carrega os sons. */
  private async ensureAudio(): Promise<void> {
    if (this.audioTried || this.disposed) return;
    this.audioTried = true;
    if (typeof AudioContext === "undefined") return;
    try {
      const ctx = new AudioContext();
      this.audioContext = ctx;
      const audio = new AudioDirector(ctx, { baseUrl: import.meta.env.BASE_URL, range: 650 });
      this.audio = audio;
      await audio.resume();
      if (this.disposed) return;
      await audio.load();
      if (this.disposed) return;
      const uiNow = useUi.getState();
      audio.setVolume(uiNow.volume);
      audio.setMuted(uiNow.muted);
      this.disposers.push(
        useUi.subscribe((s, prev) => {
          if (s.volume !== prev.volume) audio.setVolume(s.volume);
          if (s.muted !== prev.muted) audio.setMuted(s.muted);
        }),
      );
      // Diagnostico so em desenvolvimento: o bundle de producao nao pode expor
      // nada (pages.yml rejeita a string no dist).
      if (import.meta.env.DEV) {
        const debug = window as unknown as { __afterfallAudio?: () => DirectorStats };
        const stats = () => audio.stats;
        debug.__afterfallAudio = stats;
        this.disposers.push(() => {
          if (debug.__afterfallAudio === stats) delete debug.__afterfallAudio;
        });
      }
    } catch {
      this.audio = null;
    }
  }

  /** O centro da tela no mundo: e daqui que o jogador "ouve". */
  /**
   * The city's own sounds: what the animals did since the last frame, played where they did
   * it, and the beds under everything. Crickets sing at night and frogs at night near water,
   * the wind rises with the cloud, and the rain follows the weather. The animals' sounds are
   * drained every frame, heard or not, so they never pile up.
   */
  private updateSoundscape(sim: Simulation, listener: { x: number; y: number }): void {
    const heard = this.renderer.drainFaunaSounds();
    const audio = this.audio;
    if (!audio) return;
    for (const e of heard) audio.playAt(e.sound, e.x - listener.x, e.z - listener.y);
    const now = performance.now();
    if (now - this.waterCheckedAt > 1000) {
      this.waterCheckedAt = now;
      this.waterNear = waterAround(sim, listener.x, listener.y);
    }
    const sc = this.renderer.soundscape(listener.x, listener.y);
    const night = 1 - sc.daylight;
    audio.setSoundscape({
      crickets: night * (1 - sc.rain * 0.8),
      frogs: night * this.waterNear,
      wind: 0.35 + 0.5 * sc.cloud,
      rain: sc.rain,
    });
  }

  private waterCheckedAt = 0;
  private waterNear = 0;

  private audioListener(): { x: number; y: number } {
    return this.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
  }

  private updateCamera(dt: number): void {
    const cam = this.renderer.rts;
    const speed = 90 * dt * (this.keys.has("shift") ? 2 : 1);
    let r = 0;
    let f = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) f += speed;
    if (this.keys.has("s") || this.keys.has("arrowdown")) f -= speed;
    if (this.keys.has("d") || this.keys.has("arrowright")) r += speed;
    if (this.keys.has("a") || this.keys.has("arrowleft")) r -= speed;
    const m = this.mouse;
    if (m.inside && !this.leftDown && !this.rightDown && !this.ignoreMouse) {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (m.x < EDGE) r -= speed;
      if (m.x > w - EDGE) r += speed;
      if (m.y < EDGE) f += speed;
      if (m.y > h - EDGE) f -= speed;
    }
    if (r || f) cam.pan(r, f);
    if (this.keys.has("q")) cam.rotate(-1.6 * dt);
    if (this.keys.has("e")) cam.rotate(1.6 * dt);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  private ndc(x: number, y: number): [number, number] {
    return [(x / this.canvas.clientWidth) * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1];
  }

  private local(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private on<K extends keyof WindowEventMap>(
    target: Window | HTMLElement,
    type: K,
    fn: (ev: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private bindInput(): void {
    const c = this.canvas;
    this.on(c, "contextmenu", (e) => e.preventDefault());
    this.on(c, "mousedown", (e) => this.onDown(e));
    this.on(window, "mousemove", (e) => this.onMove(e));
    this.on(window, "mouseup", (e) => this.onUp(e));
    this.on(c, "mouseleave", () => (this.mouse.inside = false));
    this.on(
      c,
      "wheel",
      (e) => {
        e.preventDefault();
        this.renderer.rts.zoom(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
    this.on(window, "keydown", (e) => this.onKey(e, true));
    this.on(window, "keyup", (e) => this.onKey(e, false));
    this.on(window, "blur", () => this.keys.clear());
    this.on(window, "resize", () => this.resize());
    this.on(c, "touchstart", (e) => this.onTouchStart(e), { passive: false });
    this.on(c, "touchmove", (e) => this.onTouchMove(e), { passive: false });
    this.on(c, "touchend", (e) => this.onTouchEnd(e), { passive: false });
    this.on(c, "touchcancel", (e) => this.onTouchEnd(e), { passive: false });
    this.disposers.push(() => window.clearTimeout(this.touchHold));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = e.key.toLowerCase();
    if (down) this.keys.add(key);
    else this.keys.delete(key);
    if (!down || useUi.getState().screen !== "game") return;
    const ui = useUi.getState();
    const sim = this.sim;
    if (key === " ") {
      e.preventDefault();
      this.togglePause();
    } else if (key === "escape") {
      if (ui.buildMode) ui.set({ buildMode: null });
      else if (ui.showHelp) ui.set({ showHelp: false });
      else if (ui.showResearch) ui.set({ showResearch: false });
      else if (ui.showEcon) ui.set({ showEcon: false });
      else ui.set({ selectedUnits: [], selectedBuilding: -1, selectedStructure: -1 });
      this.renderer.buildPreview = null;
    } else if (key === "r" && ui.buildMode && sim) {
      this.turnBuild(e.shiftKey ? -1 : 1);
    } else if (key === "t" && ui.buildMode && sim) {
      this.alignBuild();
    } else if (key === "f4") {
      // Bloom and grade: auto follows the driver, and F4 overrides it either way.
      e.preventDefault();
      const next = this.renderer.postEnabled ? "off" : "on";
      this.renderer.setPost(next);
      try {
        localStorage.setItem("afterfall.post", next);
      } catch {
        /* storage unavailable */
      }
    } else if (key === "f3") {
      e.preventDefault();
      ui.set({ showDev: !ui.showDev });
    } else if (key === "f" && sim) {
      this.focusSelection();
    } else if (key === "h" && ui.selectedUnits.length) {
      this.command({ type: "returnToBase", units: ui.selectedUnits });
    } else if (/^[1-9]$/.test(key) && sim) {
      const n = Number(key);
      if (e.shiftKey && n <= 4) {
        this.setSpeed(([0, 1, 2, 4] as Speed[])[n - 1]);
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (ui.selectedUnits.length) this.command({ type: "createSquad", units: ui.selectedUnits, name: `${n}` });
      } else {
        const squad = sim.state.squads.find((s) => s.name === `${n}`);
        if (squad) ui.set({ selectedUnits: [...squad.members], selectedBuilding: -1, selectedStructure: -1 });
      }
    }
  }

  focusSelection(): void {
    const sim = this.sim;
    if (!sim) return;
    const ui = useUi.getState();
    const first = ui.selectedUnits.map((id) => sim.state.entities.get(id)).find((e) => e?.transform);
    if (first?.transform) this.renderer.rts.focus(first.transform.x, first.transform.y);
    else if (ui.selectedBuilding >= 0) {
      const b = sim.city.buildings[ui.selectedBuilding];
      this.renderer.rts.focus(b.entrance.x, b.entrance.y);
    } else if (sim.state.hq >= 0) {
      const e = sim.hqEntrance();
      this.renderer.rts.focus(e.x, e.y);
    }
  }

  focusOn(x: number, y: number): void {
    this.renderer.rts.focus(x, y);
  }

  private cellAt(px: number, py: number): [number, number] | null {
    const g = this.renderer.groundPoint(...this.ndc(px, py));
    if (!g || !this.sim) return null;
    const grid = this.sim.grid;
    return [Math.floor(g.x / grid.cell), Math.floor(g.y / grid.cell)];
  }

  private onDown(e: MouseEvent): void {
    if (this.ignoreMouse) return;
    const p = this.local(e);
    if (e.button === 0) {
      const ui = useUi.getState();
      this.leftDown = { ...p, cell: ui.buildMode ? (this.cellAt(p.x, p.y) ?? undefined) : undefined };
    } else if (e.button === 2) {
      this.rightDown = { ...p, rotating: false };
    }
  }

  private onMove(e: MouseEvent): void {
    if (this.ignoreMouse) return;
    const p = this.local(e);
    const prev = { ...this.mouse };
    this.mouse = { x: p.x, y: p.y, inside: p.x >= 0 && p.y >= 0 && p.x <= this.canvas.clientWidth && p.y <= this.canvas.clientHeight };
    const ui = useUi.getState();
    if (this.rightDown) {
      const dx = p.x - this.rightDown.x;
      if (this.rightDown.rotating || Math.abs(dx) > 6) {
        this.rightDown.rotating = true;
        this.renderer.rts.rotate((p.x - prev.x) * 0.006, (p.y - prev.y) * 0.004);
      }
      return;
    }
    if (ui.screen !== "game" || !this.sim) return;
    if (ui.buildMode) {
      this.updateBuildPreview(ui.buildMode, p);
      return;
    }
    if (this.leftDown) {
      const d = Math.hypot(p.x - this.leftDown.x, p.y - this.leftDown.y);
      if (d > CLICK_SLOP) ui.set({ dragRect: { x0: this.leftDown.x, y0: this.leftDown.y, x1: p.x, y1: p.y } });
    } else if (this.mouse.inside) {
      const b = this.renderer.pickBuilding(...this.ndc(p.x, p.y));
      if (b !== this.renderer.hoverBuilding) {
        this.renderer.hoverBuilding = b;
        this.canvas.style.cursor = b >= 0 ? "pointer" : "default";
      }
    }
  }

  private onUp(e: MouseEvent): void {
    if (this.ignoreMouse) return;
    const p = this.local(e);
    const ui = useUi.getState();
    if (e.button === 2 && this.rightDown) {
      const rotating = this.rightDown.rotating;
      this.rightDown = null;
      if (rotating) return;
      if (ui.buildMode) {
        ui.set({ buildMode: null });
        this.renderer.buildPreview = null;
        return;
      }
      this.issueOrder(p.x, p.y);
      return;
    }
    if (e.button !== 0 || !this.leftDown) return;
    const down = this.leftDown;
    this.leftDown = null;
    if (!this.sim || ui.screen !== "game") return;
    if (ui.buildMode) {
      this.placeBuild(ui.buildMode, p, e.shiftKey, this.dragStart(down, p));
      return;
    }
    if (ui.dragRect) {
      this.boxSelect(ui.dragRect, e.shiftKey);
      ui.set({ dragRect: null });
      return;
    }
    if (Math.hypot(p.x - down.x, p.y - down.y) <= CLICK_SLOP) this.clickSelect(p.x, p.y, e.shiftKey);
  }

  /** Nearest visible survivor (or infected) to a screen point. */
  pickUnit(x: number, y: number, kind: "survivor" | "infected" = "survivor"): EntityId {
    const sim = this.sim;
    if (!sim) return -1;
    let best = -1;
    let bestD = UNIT_PICK_RADIUS;
    for (const e of sim.state.entities.values()) {
      if (!e.transform) continue;
      if (kind === "survivor" && (!e.survivor || e.survivor.inside >= 0)) continue;
      if (kind === "infected" && !e.infected) continue;
      const s = this.renderer.toScreen(e.transform.x, e.transform.y, 1);
      if (!s.visible) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  private clickSelect(x: number, y: number, add: boolean): void {
    const ui = useUi.getState();
    const unit = this.pickUnit(x, y);
    if (unit >= 0) {
      const units = add
        ? ui.selectedUnits.includes(unit)
          ? ui.selectedUnits.filter((u) => u !== unit)
          : [...ui.selectedUnits, unit]
        : [unit];
      ui.set({ selectedUnits: units, selectedBuilding: -1, selectedStructure: -1 });
      return;
    }
    const nd = this.ndc(x, y);
    const s = this.renderer.pickStructure(...nd);
    if (s >= 0) {
      ui.set({ selectedStructure: s, selectedBuilding: -1, selectedUnits: add ? ui.selectedUnits : [] });
      return;
    }
    const b = this.renderer.pickBuilding(...nd);
    ui.set({ selectedBuilding: b, selectedStructure: -1, selectedUnits: add ? ui.selectedUnits : [] });
  }

  private boxSelect(r: { x0: number; y0: number; x1: number; y1: number }, add: boolean): void {
    const sim = this.sim!;
    const ui = useUi.getState();
    const minX = Math.min(r.x0, r.x1);
    const maxX = Math.max(r.x0, r.x1);
    const minY = Math.min(r.y0, r.y1);
    const maxY = Math.max(r.y0, r.y1);
    const picked: EntityId[] = [];
    for (const e of sim.survivors()) {
      if (e.survivor.inside >= 0) continue;
      const s = this.renderer.toScreen(e.transform!.x, e.transform!.y, 1);
      if (s.visible && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) picked.push(e.id);
    }
    const units = add ? [...new Set([...ui.selectedUnits, ...picked])] : picked;
    ui.set({ selectedUnits: units, selectedBuilding: units.length ? -1 : ui.selectedBuilding, selectedStructure: -1 });
  }

  /** Right-click: context-sensitive order for the selected survivors. */
  issueOrder(x: number, y: number): void {
    const sim = this.sim;
    const ui = useUi.getState();
    if (!sim || ui.selectedUnits.length === 0) return;
    const units = ui.selectedUnits;
    const z = this.pickUnit(x, y, "infected");
    if (z >= 0) {
      this.command({ type: "attack", units, target: z });
      return;
    }
    const nd = this.ndc(x, y);
    const b = this.renderer.pickBuilding(...nd);
    if (b >= 0) {
      if (sim.state.buildings[b].fn === "none") this.command({ type: "scavenge", units, building: b });
      else {
        const ent = sim.city.buildings[b].entrance;
        this.command({ type: "move", units, x: ent.x, y: ent.y });
      }
      return;
    }
    const g = this.renderer.groundPoint(...nd);
    if (g) this.command({ type: "move", units, x: g.x, y: g.y });
  }

  // -------------------------------------------------------------------
  // Building placement
  // -------------------------------------------------------------------

  private buildCells(kind: StructureKind, end: [number, number], start?: [number, number]): [number, number][] {
    const def = STRUCTURES[kind];
    if (!start || !isAxial(kind)) {
      const off = Math.floor(def.size / 2);
      return [[end[0] - off, end[1] - off]];
    }
    // Walls and gates: a straight line from where the drag started to where it is now, at
    // any angle. A row of gates closes a street the way a row of walls does.
    return lineCells(start, end).slice(0, LINE_MAX);
  }

  /**
   * The cell a wall or gate line starts from, or nothing for a click. A click that moved
   * a pixel or two (or under a camera still easing after a turn) could end on the next
   * cell, and the "line" from one to the other placed two gates where the player clicked
   * once. With the camera turned, cell borders run diagonally across the screen and that
   * pixel was easy to cross.
   */
  private dragStart(
    down: { x: number; y: number; cell?: [number, number] } | null,
    p: { x: number; y: number },
  ): [number, number] | undefined {
    if (!down?.cell) return undefined;
    return Math.hypot(p.x - down.x, p.y - down.y) > CLICK_SLOP ? down.cell : undefined;
  }

  /**
   * The banner reads this on the UI tick, which follows frames; a slow frame would
   * leave the count and the angle stale for seconds after a move or a key. A change
   * repaints it at once.
   */
  private setBuildInfo(next: NonNullable<GameController["buildInfo"]>): void {
    const prev = this.buildInfo;
    this.buildInfo = next;
    if (
      prev &&
      prev.count === next.count &&
      prev.capped === next.capped &&
      prev.manual === next.manual &&
      prev.steep === next.steep &&
      prev.street === next.street
    )
      return;
    const ui = useUi.getState();
    ui.set({ frame: ui.frame + 1 });
  }

  /** The angle a single piece takes: the player's turn, else what fits the spot. */
  private currentYaw(kind: StructureKind, cell: [number, number] | null): number {
    if (this.buildYawKind !== kind) {
      this.buildYawKind = kind;
      this.buildYaw = null;
    }
    if (this.buildYaw !== null) return this.buildYaw;
    return cell && this.sim ? placementYaw(this.sim, kind, cell[0], cell[1]) : 0;
  }

  private cellValid(kind: StructureKind, cx: number, cy: number, yaw: number): boolean {
    const sim = this.sim!;
    return !!sim.hqBuilding && placementAt(sim, kind, cx, cy, isAxial(kind) ? 0 : yaw) !== null;
  }

  /** Whether ground steeper than the build grade lies under a piece placed at this cell. */
  private tooSteep(kind: StructureKind, cx: number, cy: number): boolean {
    const g = this.sim?.grid;
    if (!g?.steep) return false;
    const size = STRUCTURES[kind].size;
    for (let y = cy; y < cy + size; y++)
      for (let x = cx; x < cx + size; x++) if (g.inBounds(x, y) && g.steep[g.index(x, y)] > BALANCE.terrainBuildGrade) return true;
    return false;
  }

  private updateBuildPreview(kind: StructureKind, p: { x: number; y: number }): void {
    const end = this.cellAt(p.x, p.y);
    if (!end) return;
    const start = this.dragStart(this.leftDown, p);
    const cells = this.buildCells(kind, end, start);
    const yaw = cells.length === 1 ? this.currentYaw(kind, cells[0]) : undefined;
    const valid = cells.map(([x, y]) => this.cellValid(kind, x, y, yaw ?? 0));
    this.setBuildInfo({
      count: valid.filter(Boolean).length,
      // The line stops at the cap, short of the pointer: say so instead of just stopping.
      capped: !!start && cells.length === LINE_MAX && (cells[LINE_MAX - 1][0] !== end[0] || cells[LINE_MAX - 1][1] !== end[1]),
      manual: this.buildYaw !== null,
      // A red piece on a hillside is the slope, not a bug: say so.
      steep: cells.some(([x, y], i) => !valid[i] && this.tooSteep(kind, x, y)),
      // Likewise a farm or a well on the street: it is the paving, so say so.
      street: onPaving(kind) && cells.some(([x, y], i) => !valid[i] && coversStreet(this.sim!, kind, x, y, yaw ?? 0)),
    });
    this.renderer.buildPreview = {
      kind,
      cells,
      valid,
      yaw,
      // A single wall or gate shows where it will really sit: on the line it joins.
      frame: yaw !== undefined && isAxial(kind) ? previewFrame(this.sim!, cells[0][0], cells[0][1], yaw) : undefined,
    };
  }

  /** One step of R. Shift is a turn the other way. Touch buttons call this too. */
  turnBuild(direction: 1 | -1): void {
    const ui = useUi.getState();
    if (!ui.buildMode || !this.sim) return;
    const kind = ui.buildMode;
    const end = this.cellAt(this.mouse.x, this.mouse.y);
    const base = this.currentYaw(kind, end ? this.buildCells(kind, end)[0] : null);
    const next = base + direction * ROTATE_STEP;
    // A panel looks the same half a turn on; a tower, farm or well does not.
    this.buildYaw = isAxial(kind) ? foldYaw(next) : foldTurn(next);
    if (this.buildInfo) this.setBuildInfo({ ...this.buildInfo, manual: true });
    this.updateBuildPreview(kind, this.mouse);
  }

  /** Back to automatic: the piece lines up with the wall it joins or the street again. */
  alignBuild(): void {
    const ui = useUi.getState();
    if (!ui.buildMode || !this.sim) return;
    this.buildYaw = null;
    if (this.buildInfo) this.setBuildInfo({ ...this.buildInfo, manual: false });
    this.updateBuildPreview(ui.buildMode, this.mouse);
  }

  cancelBuild(): void {
    useUi.getState().set({ buildMode: null });
    this.buildYaw = null;
    this.renderer.buildPreview = null;
  }

  private notePointer(p: { x: number; y: number }): void {
    // `inside` stays false so a finger at the screen edge does not also edge-scroll.
    this.mouse = { x: p.x, y: p.y, inside: false };
  }

  private grabCamera(dx: number, dy: number): void {
    const cam = this.renderer.rts;
    const pan = grabPan(dx, dy, cam.distance, cam.camera.fov, this.canvas.clientHeight);
    cam.pan(pan.right, pan.forward);
  }

  private rememberPinch(a: { x: number; y: number }, b: { x: number; y: number }): void {
    this.touchPinch = {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.ignoreMouse = true;
    this.touchToken += 1;
    for (const t of Array.from(e.changedTouches)) this.touchPoints.set(t.identifier, this.local(t));
    this.beginTouch();
  }

  private beginTouch(): void {
    window.clearTimeout(this.touchHold);
    const pts = [...this.touchPoints.values()];
    if (pts.length >= 2) {
      this.touchMode = "pinch";
      if (useUi.getState().dragRect) useUi.getState().set({ dragRect: null });
      this.rememberPinch(pts[0], pts[1]);
      return;
    }
    const p = pts[0];
    if (!p) return;
    const ui = useUi.getState();
    this.touchMode = "pending";
    this.touchStart = {
      x: p.x,
      y: p.y,
      cell: ui.buildMode ? (this.cellAt(p.x, p.y) ?? undefined) : undefined,
    };
    this.touchLast = { x: p.x, y: p.y };
    this.notePointer(p);
    if (ui.buildMode && ui.screen === "game") this.updateBuildPreview(ui.buildMode, p);
    else if (ui.screen === "game") {
      this.touchHold = window.setTimeout(() => {
        if (this.touchMode === "pending") this.touchMode = "box";
      }, LONG_PRESS_MS);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.touchPoints.set(t.identifier, this.local(t));
    const pts = [...this.touchPoints.values()];
    if (pts.length >= 2) {
      window.clearTimeout(this.touchHold);
      if (useUi.getState().dragRect) useUi.getState().set({ dragRect: null });
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (this.touchMode !== "pinch") {
        this.touchMode = "pinch";
        this.rememberPinch(pts[0], pts[1]);
        return;
      }
      const cam = this.renderer.rts;
      cam.zoom(pinchFactor(this.touchPinch.dist, dist));
      cam.rotate(twistDelta(this.touchPinch.angle, angle));
      this.grabCamera(midX - this.touchPinch.midX, midY - this.touchPinch.midY);
      this.touchPinch = { dist, angle, midX, midY };
      return;
    }
    const p = pts[0];
    if (!p) return;
    this.notePointer(p);
    const ui = useUi.getState();
    const moved = Math.hypot(p.x - this.touchStart.x, p.y - this.touchStart.y);
    if (ui.buildMode) {
      if (this.touchMode === "pending" && moved > TAP_SLOP) {
        window.clearTimeout(this.touchHold);
        this.touchMode = "build";
      }
      if (this.touchMode === "pending" || this.touchMode === "build") this.updateBuildPreview(ui.buildMode, p);
    } else if (this.touchMode === "box") {
      ui.set({ dragRect: { x0: this.touchStart.x, y0: this.touchStart.y, x1: p.x, y1: p.y } });
    } else if (this.touchMode === "pending" && moved > TAP_SLOP) {
      window.clearTimeout(this.touchHold);
      this.touchMode = "pan";
    }
    if (this.touchMode === "pan") this.grabCamera(p.x - this.touchLast.x, p.y - this.touchLast.y);
    this.touchLast = p;
  }

  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    const lifted = e.changedTouches.length ? this.local(e.changedTouches[e.changedTouches.length - 1]) : this.touchLast;
    for (const t of Array.from(e.changedTouches)) this.touchPoints.delete(t.identifier);
    if (this.touchPoints.size > 0) {
      // A finger left over keeps panning or pinching. It must not become a tap.
      window.clearTimeout(this.touchHold);
      const pts = [...this.touchPoints.values()];
      if (pts.length >= 2) {
        this.touchMode = "pinch";
        this.rememberPinch(pts[0], pts[1]);
      } else {
        this.touchMode = "pan";
        this.touchLast = pts[0];
      }
      return;
    }
    this.finishTouch(lifted);
    const token = this.touchToken;
    window.setTimeout(() => {
      if (this.touchToken === token) this.ignoreMouse = false;
    }, 800);
  }

  private finishTouch(p: { x: number; y: number }): void {
    window.clearTimeout(this.touchHold);
    const mode = this.touchMode;
    this.touchMode = "pending";
    this.mouse.inside = false;
    const ui = useUi.getState();
    if (!this.sim || ui.screen !== "game" || mode === "pan" || mode === "pinch") {
      if (ui.dragRect) ui.set({ dragRect: null });
      return;
    }
    if (mode === "box") {
      const rect = ui.dragRect;
      if (rect && Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) > TAP_SLOP) this.boxSelect(rect, false);
      else this.touchTap(p.x, p.y, true);
      if (ui.dragRect) ui.set({ dragRect: null });
      return;
    }
    if (ui.buildMode && (mode === "build" || mode === "pending")) {
      const moved = Math.hypot(p.x - this.touchStart.x, p.y - this.touchStart.y) > TAP_SLOP;
      this.placeBuild(ui.buildMode, p, false, moved ? this.touchStart.cell : undefined);
      return;
    }
    this.touchTap(p.x, p.y, false);
  }

  /** Tap: select. With a selection, a tap on the ground, a building or an infected is the order. */
  private touchTap(x: number, y: number, add: boolean): void {
    const ui = useUi.getState();
    if (ui.buildMode) {
      this.placeBuild(ui.buildMode, { x, y }, false, undefined);
      return;
    }
    const unit = this.pickUnit(x, y);
    if (unit >= 0) {
      if (!add && ui.selectedUnits.length === 1 && ui.selectedUnits[0] === unit) {
        ui.set({ selectedUnits: [], selectedBuilding: -1, selectedStructure: -1 });
        return;
      }
      this.clickSelect(x, y, add);
      return;
    }
    if (!add && ui.selectedUnits.length > 0) {
      const structure = this.renderer.pickStructure(...this.ndc(x, y));
      if (structure >= 0) {
        ui.set({ selectedStructure: structure, selectedBuilding: -1, selectedUnits: [] });
        return;
      }
      this.issueOrder(x, y);
      return;
    }
    this.clickSelect(x, y, add);
  }

  private placeBuild(kind: StructureKind, p: { x: number; y: number }, keep: boolean, start?: [number, number]): void {
    const end = this.cellAt(p.x, p.y);
    const ui = useUi.getState();
    if (!end) return;
    const cells = this.buildCells(kind, end, start);
    const yaw = cells.length === 1 ? this.currentYaw(kind, cells[0]) : undefined;
    this.command({ type: "placeStructures", kind, cells, yaw });
    this.renderer.buildPreview = null;
    if (!keep && !isAxial(kind)) ui.set({ buildMode: null });
  }
}

const SLOW_GPU_KEY = "afterfall.slowGpu";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `?quality=low|high|auto` for captures and for a machine the automatic choice gets wrong. */
function initialQuality(): QualityMode {
  const q = new URLSearchParams(window.location.search).get("quality");
  return q === "low" || q === "high" ? q : "auto";
}

/** `?post=on|off` wins (captures use it), then the player's last F4 choice, then the driver. */
function initialPost(): PostMode {
  const valid = (v: string | null): v is PostMode => v === "on" || v === "off" || v === "auto";
  try {
    const q = new URLSearchParams(window.location.search).get("post");
    if (valid(q)) return q;
    const saved = localStorage.getItem("afterfall.post");
    if (valid(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return "auto";
}

/** How much open water lies within 60 m of a point, 0 to 1: a river along the view is 1. */
function waterAround(sim: Simulation, x: number, y: number): number {
  const g = sim.grid;
  let water = 0;
  let all = 0;
  for (let dy = -60; dy <= 60; dy += 6)
    for (let dx = -60; dx <= 60; dx += 6) {
      const cx = Math.floor((x + dx) / g.cell);
      const cy = Math.floor((y + dy) / g.cell);
      if (!g.inBounds(cx, cy)) continue;
      all++;
      if (g.kind[g.index(cx, cy)] === CellKind.Water) water++;
    }
  return all ? Math.min(1, (water / all) * 5) : 0;
}
