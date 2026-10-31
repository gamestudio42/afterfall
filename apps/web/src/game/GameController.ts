import { STRUCTURES, type StructureKind } from "@afterfall/content";
import { Simulation, deserialize, serialize, type Command, type EntityId } from "@afterfall/core";
import type { CityMap } from "@afterfall/world";
import { GameRenderer } from "@afterfall/renderer";
import { CellKind } from "@afterfall/world";
import { putSave } from "../app/saves";
import { useUi, type Speed } from "../app/store";
import { translate } from "../i18n";

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
  private rightDown: { x: number; y: number; rotating: boolean } | null = null;
  private uiTimer = 0;
  private lastDay = 0;
  fps = 60;
  private disposers: (() => void)[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new GameRenderer(canvas);
    this.bindInput();
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /** Starts a game on a generated city, or on an imported real map when one is given. */
  newGame(seed: number, map?: CityMap): void {
    this.attach(new Simulation({ seed: map?.seed ?? seed, map }));
  }

  load(data: string): void {
    this.attach(deserialize(data));
  }

  private attach(sim: Simulation): void {
    this.sim = sim;
    this.renderer.setSimulation(sim);
    this.lastDay = sim.clock.day;
    const ui = useUi.getState();
    ui.set({ selectedUnits: [], selectedBuilding: -1, selectedStructure: -1, buildMode: null, speed: 1, lastSpeed: 1 });
    if (sim.state.hq >= 0) {
      const e = sim.hqEntrance();
      this.renderer.rts.jumpTo(e.x, e.y);
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __afterfall: GameController }).__afterfall = this;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
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

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const ui = useUi.getState();
    if (ui.screen !== "game" || !this.sim) return;
    const sim = this.sim;
    // Hold time while a decision is pending so the player can read it.
    const speed = sim.state.pendingEvent || (sim.state.outcome && sim.state.outcome.type === "defeat") ? 0 : ui.speed;
    sim.update(dt * 1000, speed);
    this.updateCamera(dt);
    const r = this.renderer;
    r.selection = { units: ui.selectedUnits, building: ui.selectedBuilding, structure: ui.selectedStructure };
    r.render(dt);

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
    if (m.inside && !this.leftDown && !this.rightDown) {
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

  private local(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private on<K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void {
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
    this.on(c, "wheel", (e) => {
      e.preventDefault();
      this.renderer.rts.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
    this.on(window, "keydown", (e) => this.onKey(e, true));
    this.on(window, "keyup", (e) => this.onKey(e, false));
    this.on(window, "blur", () => this.keys.clear());
    this.on(window, "resize", () => this.resize());
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
      else ui.set({ selectedUnits: [], selectedBuilding: -1, selectedStructure: -1 });
      this.renderer.buildPreview = null;
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
    const p = this.local(e);
    if (e.button === 0) {
      const ui = useUi.getState();
      this.leftDown = { ...p, cell: ui.buildMode ? this.cellAt(p.x, p.y) ?? undefined : undefined };
    } else if (e.button === 2) {
      this.rightDown = { ...p, rotating: false };
    }
  }

  private onMove(e: MouseEvent): void {
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
      this.placeBuild(ui.buildMode, p, e.shiftKey, down.cell);
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
      const units = add ? (ui.selectedUnits.includes(unit) ? ui.selectedUnits.filter((u) => u !== unit) : [...ui.selectedUnits, unit]) : [unit];
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
    if (!start || (kind !== "wall")) {
      const off = Math.floor(def.size / 2);
      return [[end[0] - off, end[1] - off]];
    }
    // Walls: straight line along the dominant axis.
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const cells: [number, number][] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = Math.sign(dx) || 1;
      for (let i = 0; i <= Math.abs(dx); i++) cells.push([start[0] + i * s, start[1]]);
    } else {
      const s = Math.sign(dy) || 1;
      for (let i = 0; i <= Math.abs(dy); i++) cells.push([start[0], start[1] + i * s]);
    }
    return cells.slice(0, 200);
  }

  private cellValid(kind: StructureKind, cx: number, cy: number): boolean {
    const g = this.sim!.grid;
    const size = STRUCTURES[kind].size;
    for (let y = cy; y < cy + size; y++)
      for (let x = cx; x < cx + size; x++) {
        if (!g.inBounds(x, y)) return false;
        const i = g.index(x, y);
        if (g.kind[i] !== CellKind.Free || g.structureAt[i] !== -1) return false;
      }
    return true;
  }

  private updateBuildPreview(kind: StructureKind, p: { x: number; y: number }): void {
    const end = this.cellAt(p.x, p.y);
    if (!end) return;
    const cells = this.buildCells(kind, end, this.leftDown?.cell);
    this.renderer.buildPreview = { kind, cells, valid: cells.map(([x, y]) => this.cellValid(kind, x, y)) };
  }

  private placeBuild(kind: StructureKind, p: { x: number; y: number }, keep: boolean, start?: [number, number]): void {
    const end = this.cellAt(p.x, p.y);
    const ui = useUi.getState();
    if (!end) return;
    const cells = this.buildCells(kind, end, start);
    this.command({ type: "placeStructures", kind, cells });
    this.renderer.buildPreview = null;
    if (!keep && kind !== "wall") ui.set({ buildMode: null });
  }
}
