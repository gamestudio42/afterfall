import { BALANCE, INFECTED, STRUCTURES, hordeForNight } from "@afterfall/content";
import { TICK_SECONDS, type Vec2 } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import type { Simulation } from "../simulation";
import type { Entity, InfectedComp } from "../state";

type InfectedEntity = Entity & { infected: InfectedComp };

/**
 * Distance fields shared by every infected: one leading to the
 * headquarters (walls are expensive but passable, so hordes pick the
 * weakest line) and one leading out of the city for retreats.
 */
export class InfectedFields {
  assault: Float32Array | null = null;
  retreat: Float32Array | null = null;
  private assaultVersion = -1;
  private retreatVersion = -1;
  private assaultHq = -1;

  constructor(private sim: Simulation) {}

  assaultCost = (i: number): number => {
    const k = this.sim.grid.kind[i];
    if (k === CellKind.Free || k === CellKind.Soft) return 1;
    if (k === CellKind.Building) return Infinity;
    const s = this.sim.state.entities.get(this.sim.grid.structureAt[i]);
    const hp = s?.health?.max ?? 200;
    return 1 + hp / 12;
  };

  retreatCost = (i: number): number => {
    const k = this.sim.grid.kind[i];
    return k === CellKind.Free || k === CellKind.Soft ? 1 : Infinity;
  };

  getAssault(): Float32Array | null {
    const sim = this.sim;
    const hq = sim.state.hq;
    if (hq < 0) return null;
    if (this.assault && this.assaultVersion === sim.grid.version && this.assaultHq === hq) return this.assault;
    const goals = hqPerimeter(sim);
    this.assault = sim.grid.distanceField(goals, this.assaultCost, this.assault ?? undefined);
    this.assaultVersion = sim.grid.version;
    this.assaultHq = hq;
    return this.assault;
  }

  getRetreat(): Float32Array {
    const sim = this.sim;
    if (this.retreat && this.retreatVersion === sim.grid.version) return this.retreat;
    const g = sim.grid;
    const goals: number[] = [];
    for (let x = 0; x < g.cols; x++) {
      for (const y of [0, g.rows - 1]) if (g.passableIndex(g.index(x, y), "infected")) goals.push(g.index(x, y));
    }
    for (let y = 0; y < g.rows; y++) {
      for (const x of [0, g.cols - 1]) if (g.passableIndex(g.index(x, y), "infected")) goals.push(g.index(x, y));
    }
    this.retreat = g.distanceField(goals, this.retreatCost, this.retreat ?? undefined);
    this.retreatVersion = g.version;
    return this.retreat;
  }
}

/** Free cells touching the HQ footprint. */
export function hqPerimeter(sim: Simulation): number[] {
  const b = sim.city.buildings[sim.state.hq];
  const g = sim.grid;
  if (b.footprint) return footprintPerimeter(sim, sim.state.hq);
  const x0 = Math.floor(b.rect.x / g.cell) - 1;
  const y0 = Math.floor(b.rect.y / g.cell) - 1;
  const x1 = Math.ceil((b.rect.x + b.rect.w) / g.cell);
  const y1 = Math.ceil((b.rect.y + b.rect.h) / g.cell);
  const out: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (!g.inBounds(x, y)) continue;
      const i = g.index(x, y);
      if (g.kind[i] !== CellKind.Building) out.push(i);
    }
  return out;
}

/** Non-building cells next to any cell of an imported building's outline. */
function footprintPerimeter(sim: Simulation, index: number): number[] {
  const g = sim.grid;
  const b = sim.city.buildings[index];
  const x0 = Math.max(0, Math.floor(b.rect.x / g.cell) - 1);
  const y0 = Math.max(0, Math.floor(b.rect.y / g.cell) - 1);
  const x1 = Math.min(g.cols - 1, Math.ceil((b.rect.x + b.rect.w) / g.cell));
  const y1 = Math.min(g.rows - 1, Math.ceil((b.rect.y + b.rect.h) / g.cell));
  const out: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = g.index(x, y);
      if (g.kind[i] === CellKind.Building) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!g.inBounds(x + dx, y + dy)) continue;
          if (g.buildingAt[g.index(x + dx, y + dy)] === index && g.kind[g.index(x + dx, y + dy)] === CellKind.Building) {
            touches = true;
            break;
          }
        }
      if (touches) out.push(i);
    }
  return out;
}

export function infectedSystem(sim: Simulation): void {
  const clock = sim.clock;
  spawnHordes(sim);
  const night = clock.phase === "night" || clock.phase === "dusk";
  const dawnRetreat = clock.hour === 6 && clock.minute === 0 && sim.state.tick % 10 === 0;
  // At dusk some of the roaming infected near the settlement are drawn to it.
  const rally = clock.hour === 20 && clock.minute === 0 && sim.state.tick % 10 === 0 && sim.state.hq >= 0;
  const hqPos = sim.hqEntrance();
  for (const e of [...sim.infected()]) {
    const z = e.infected;
    const def = INFECTED[z.kind];
    if (rally && z.horde < 0 && (z.state.type === "idle" || z.state.type === "wander")) {
      const d = Math.hypot(e.transform!.x - hqPos.x, e.transform!.y - hqPos.y);
      if (d < 140 && sim.rng.chance(0.35)) {
        z.state = { type: "assault" };
        sim.stop(e);
      }
    }
    z.cooldown = Math.max(0, z.cooldown - TICK_SECONDS);
    z.bob += TICK_SECONDS * def.speed * 4;
    if (dawnRetreat && z.state.type !== "chase") {
      if (z.horde >= 0) {
        z.state = { type: "retreat" };
        sim.stop(e);
      } else if (z.state.type === "assault") {
        z.state = { type: "idle" };
        z.restTimer = 2;
        sim.stop(e);
      }
    }
    // Staggered thinking: each infected re-evaluates twice a second.
    const think = (sim.state.tick + e.id) % 5 === 0;
    if (think && z.state.type !== "retreat") perceive(sim, e, night ? def.visionNight : def.visionDay);
    switch (z.state.type) {
      case "idle":
        z.restTimer -= TICK_SECONDS;
        if (z.restTimer <= 0) {
          const t = e.transform!;
          const p = sim.grid.nearestPassable(t.x + sim.rng.range(-25, 25), t.y + sim.rng.range(-25, 25), "infected", 6);
          if (p && sim.setDestination(e, p.x, p.y, "infected")) z.state = { type: "wander", x: p.x, y: p.y };
          else z.restTimer = sim.rng.range(3, 8);
        }
        break;
      case "wander":
      case "investigate":
        if (sim.arrived(e)) {
          z.state = { type: "idle" };
          z.restTimer = sim.rng.range(4, 14);
        }
        break;
      case "chase":
        chase(sim, e);
        break;
      case "assault":
        assault(sim, e);
        break;
      case "retreat":
        retreat(sim, e);
        break;
    }
  }
}

function perceive(sim: Simulation, e: InfectedEntity, vision: number): void {
  const z = e.infected;
  if (z.state.type === "chase") return;
  const t = e.transform!;
  let best: Entity | null = null;
  let bestD = vision * vision;
  sim.survivorHash.query(t.x, t.y, vision, (id) => {
    const o = sim.state.entities.get(id);
    if (!o?.transform || !o.survivor) return;
    const d = (o.transform.x - t.x) ** 2 + (o.transform.y - t.y) ** 2;
    if (d >= bestD) return;
    if (!sim.grid.lineOfSight(t.x, t.y, o.transform.x, o.transform.y)) return;
    bestD = d;
    best = o;
  });
  if (best) {
    const b = best as Entity;
    z.state = { type: "chase", target: b.id, lastX: b.transform!.x, lastY: b.transform!.y, repathAt: 0 };
  }
}

/** Gunfire and other noise pulls nearby idle infected towards the source. */
export function emitNoise(sim: Simulation, x: number, y: number, radius: number): void {
  sim.infectedHash.query(x, y, radius, (id) => {
    const o = sim.state.entities.get(id);
    if (!o?.infected || !o.transform) return;
    const st = o.infected.state.type;
    if (st !== "idle" && st !== "wander" && st !== "investigate") return;
    if ((o.transform.x - x) ** 2 + (o.transform.y - y) ** 2 > radius * radius) return;
    const p = sim.grid.nearestPassable(x, y, "infected", 4);
    if (p && sim.setDestination(o, p.x, p.y, "infected")) o.infected.state = { type: "investigate", x: p.x, y: p.y };
  });
}

function chase(sim: Simulation, e: InfectedEntity): void {
  const z = e.infected;
  const st = z.state as Extract<InfectedComp["state"], { type: "chase" }>;
  const target = sim.state.entities.get(st.target);
  const t = e.transform!;
  const def = INFECTED[z.kind];
  const lost = !target || !target.transform || !target.survivor || target.survivor.inside >= 0;
  if (lost) {
    const p = { x: st.lastX, y: st.lastY };
    z.state = { type: "investigate", x: p.x, y: p.y };
    if (!sim.setDestination(e, p.x, p.y, "infected")) z.state = { type: "idle" };
    return;
  }
  const tt = target.transform!;
  const d = Math.hypot(tt.x - t.x, tt.y - t.y);
  // A survivor on a tower cannot be reached: attack the tower instead.
  if (target.survivor!.mounted >= 0) {
    const tower = sim.state.entities.get(target.survivor!.mounted);
    if (tower && d < 3.2) {
      sim.stop(e);
      hitStructure(sim, e, tower);
      return;
    }
  }
  if (d > def.visionNight * 1.8) {
    z.state = { type: "investigate", x: tt.x, y: tt.y };
    sim.setDestination(e, tt.x, tt.y, "infected");
    return;
  }
  st.lastX = tt.x;
  st.lastY = tt.y;
  if (d <= 1.25 && target.survivor!.mounted < 0) {
    sim.stop(e);
    if (z.cooldown <= 0) {
      z.cooldown = def.cooldown;
      biteSurvivor(sim, e, target);
    }
    return;
  }
  if (sim.state.tick >= st.repathAt) {
    st.repathAt = sim.state.tick + 12 + (e.id % 7);
    if (sim.grid.walkable(t.x, t.y, tt.x, tt.y, "infected", 0.3)) {
      e.mover!.path = [{ x: tt.x, y: tt.y }];
      e.mover!.goal = { x: tt.x, y: tt.y };
    } else if (!sim.setDestination(e, tt.x, tt.y, "infected")) {
      // Blocked by a wall: at night batter the settlement, by day lose interest.
      const c = sim.clock;
      if (c.phase === "night" || c.phase === "dusk") z.state = { type: "assault" };
      else {
        z.state = { type: "idle" };
        z.restTimer = 6;
      }
    }
  }
}

function biteSurvivor(sim: Simulation, e: InfectedEntity, target: Entity): void {
  const def = INFECTED[e.infected.kind];
  const h = target.health!;
  h.hp -= def.damage;
  sim.emitFx("melee", e.transform!.x, e.transform!.y, target.transform!.x, target.transform!.y);
  const s = target.survivor!;
  if (!s.infected && sim.rng.chance(BALANCE.biteInfectionChance)) {
    s.infected = true;
    s.infection = 1;
    sim.alert("alert.bitten", { name: s.name }, "danger", { x: target.transform!.x, y: target.transform!.y });
  }
  s.morale = Math.max(0, s.morale - 0.5);
}

function assault(sim: Simulation, e: InfectedEntity): void {
  const field = sim.fields.getAssault();
  const t = e.transform!;
  const m = e.mover!;
  if (!field) {
    e.infected.state = { type: "idle" };
    return;
  }
  // Keep walking towards the current step.
  if (m.path.length > 0) return;
  const g = sim.grid;
  const here = g.cellOf(t.x, t.y);
  if (field[here] === Infinity) {
    // Not connected to the base (e.g. trapped). Wander instead.
    e.infected.state = { type: "idle" };
    e.infected.restTimer = 5;
    return;
  }
  if (field[here] < 0.5) {
    attackHq(sim, e);
    return;
  }
  const next = g.descend(field, here, sim.fields.assaultCost);
  if (next < 0) {
    attackHq(sim, e);
    return;
  }
  const k = g.kind[next];
  if (k === CellKind.Solid || k === CellKind.Gate) {
    const s = sim.state.entities.get(g.structureAt[next]);
    if (s) {
      hitStructure(sim, e, s);
      return;
    }
  }
  const c = g.centerOf(next);
  // Small per-agent jitter keeps the horde from moving in single file.
  const j = ((e.id * 2654435761) >>> 0) / 4294967296 - 0.5;
  m.path = [{ x: c.x + j * 0.6, y: c.y - j * 0.6 }];
  m.goal = null;
}

function attackHq(sim: Simulation, e: InfectedEntity): void {
  const z = e.infected;
  if (z.cooldown > 0) return;
  const def = INFECTED[z.kind];
  z.cooldown = def.cooldown;
  const hq = sim.hqBuilding;
  if (!hq) return;
  hq.hp = Math.max(0, hq.hp - def.structureDamage * 0.5);
  sim.state.lastAttackTick = sim.state.tick;
  const ent = sim.hqEntrance();
  sim.emitFx("melee", e.transform!.x, e.transform!.y, ent.x, ent.y);
  sim.alertOnce("alert.hqUnderAttack", 900, {}, "danger", ent);
}

function hitStructure(sim: Simulation, e: InfectedEntity, s: Entity): void {
  const z = e.infected;
  if (z.cooldown > 0) return;
  const def = INFECTED[z.kind];
  z.cooldown = def.cooldown;
  const h = s.health;
  if (!h) return;
  h.hp -= def.structureDamage;
  sim.state.lastAttackTick = sim.state.tick;
  sim.emitFx("melee", e.transform!.x, e.transform!.y, s.transform!.x, s.transform!.y);
  sim.alertOnce("alert.wallUnderAttack", 900, {}, "danger", { x: s.transform!.x, y: s.transform!.y });
  if (h.hp <= 0) destroyStructure(sim, s);
}

export function destroyStructure(sim: Simulation, s: Entity): void {
  const st = s.structure!;
  for (const id of sim.state.entities.keys()) {
    const o = sim.state.entities.get(id)!;
    if (o.survivor && o.survivor.mounted === s.id) {
      o.survivor.mounted = -1;
      if (o.survivor.activity.type === "task") o.survivor.activity = { type: "idle" };
    }
  }
  if (st.task >= 0) {
    const task = sim.state.tasks.get(st.task);
    if (task) {
      for (const w of task.assigned) {
        const we = sim.state.entities.get(w);
        if (we?.survivor && we.survivor.activity.type === "task") we.survivor.activity = { type: "idle" };
      }
      sim.state.tasks.delete(task.id);
    }
  }
  for (const task of sim.state.tasks.values()) task.structures = task.structures.filter((x) => x !== s.id);
  for (const [id, task] of sim.state.tasks) if (task.structures.length === 0 && task.building < 0) sim.state.tasks.delete(id);
  sim.grid.setStructure(st.cells, CellKind.Free, -1);
  sim.removeEntity(s.id);
  sim.emitFx("death", s.transform!.x, s.transform!.y);
  sim.alert("alert.structureDestroyed", { kind: st.kind }, "danger", { x: s.transform!.x, y: s.transform!.y });
}

function retreat(sim: Simulation, e: InfectedEntity): void {
  const m = e.mover!;
  if (m.path.length > 0) return;
  const field = sim.fields.getRetreat();
  const g = sim.grid;
  const here = g.cellOf(e.transform!.x, e.transform!.y);
  if (field[here] === Infinity || field[here] < 1.5) {
    sim.removeEntity(e.id);
    return;
  }
  const next = g.descend(field, here, sim.fields.retreatCost);
  if (next < 0) {
    sim.removeEntity(e.id);
    return;
  }
  const c = g.centerOf(next);
  m.path = [c];
}

/** Night hordes: waves enter from the city edge at fixed hours. */
function spawnHordes(sim: Simulation): void {
  if (sim.state.hq < 0) return;
  const clock = sim.clock;
  if (sim.state.tick % 10 !== 0) return;
  const night = clock.hour >= 12 ? clock.day : clock.day - 1;
  if (night < 1) return;
  const spec = hordeForNight(night);
  if (!spec) return;
  const minuteOfNight = ((clock.hour + 24 - 21) % 24) * 60 + clock.minute;
  if (clock.hour >= 6 && clock.hour < 21) return;
  for (let w = 0; w < spec.waves; w++) {
    const at = w * 150;
    if (minuteOfNight !== at) continue;
    if (sim.state.hordes.some((h) => h.night === night && h.wave === w)) continue;
    const hq = sim.hqEntrance();
    // Prefer entry points far from the base, but vary them.
    const pts = [...sim.city.spawnPoints].sort((a, b) => dist2(b, hq) - dist2(a, hq) || a.x - b.x || a.y - b.y);
    const spawn = pts[sim.rng.int(0, Math.min(pts.length - 1, 7))];
    const share = (n: number) => Math.floor(n / spec.waves) + (w < n % spec.waves ? 1 : 0);
    const counts = { walker: share(spec.walkers), runner: share(spec.runners), brute: w === spec.waves - 1 ? spec.brutes : 0 };
    const id = sim.state.hordes.length + 1;
    let size = 0;
    for (const [kind, n] of Object.entries(counts) as [keyof typeof counts, number][]) {
      for (let i = 0; i < n; i++) {
        const p = sim.grid.nearestPassable(spawn.x + sim.rng.range(-4, 4), spawn.y + sim.rng.range(-4, 4), "infected", 4) ?? spawn;
        sim.spawnInfected(kind, p.x, p.y, id);
        size++;
      }
    }
    sim.state.hordes.push({ id, night, wave: w, spawn, size });
    sim.state.stats.hordesSpawned++;
    sim.alert("alert.hordeDetected", { count: size, dir: direction(sim, spawn) }, "danger", spawn);
  }
}

function dist2(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function direction(sim: Simulation, p: Vec2): string {
  const hq = sim.hqEntrance();
  const dx = p.x - hq.x;
  const dy = p.y - hq.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

export { STRUCTURES };
