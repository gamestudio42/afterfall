import { BALANCE, BUILDING_FUNCTIONS, RESOURCE_IDS, STRUCTURES, WEAPONS, addToBag, bagTotal, type ResourceBag } from "@afterfall/content";
import type { Vec2 } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import type { Simulation } from "../simulation";
import { TOWER_RANGE_BONUS } from "./combat";
import type { Entity, EntityId, SurvivorComp, Task, TaskType } from "../state";
import {
  MINUTES_PER_TICK,
  carrySpace,
  dist,
  efficiency,
  exitBuilding,
  gainXp,
  isSleepTime,
  isWorkTime,
  skillFactor,
  unloadAndRestock,
} from "./util";

type SurvivorEntity = Entity & { survivor: SurvivorComp };

const PRIORITY: Record<TaskType, number> = {
  guard: 60,
  repair: 75,
  build: 55,
  convert: 50,
  craft: 35,
  farm: 40,
};

export function createTask(sim: Simulation, type: TaskType, init: Partial<Task>): Task {
  const id = sim.state.nextId++;
  const task: Task = {
    id,
    type,
    structures: [],
    building: -1,
    priority: PRIORITY[type],
    maxWorkers: 3,
    assigned: [],
    cost: {},
    delivered: {},
    inTransit: {},
    work: 0,
    progress: 0,
    status: "pending",
    createdTick: sim.state.tick,
    ...init,
  };
  sim.state.tasks.set(id, task);
  return task;
}

/** Resources still to be fetched for a task. */
export function outstanding(task: Task): ResourceBag {
  const out: ResourceBag = {};
  for (const id of RESOURCE_IDS) {
    const need = (task.cost[id] ?? 0) - (task.delivered[id] ?? 0) - (task.inTransit[id] ?? 0);
    if (need > 1e-6) out[id] = need;
  }
  return out;
}

function deliveredFraction(task: Task): number {
  const total = bagTotal(task.cost);
  if (total <= 0) return 1;
  return Math.min(1, bagTotal(task.delivered) / total);
}

export function taskSystem(sim: Simulation): void {
  if (sim.state.tick % 10 !== 0) return;
  const clock = sim.clock;
  createAutomaticTasks(sim);
  const totals = sim.totals();

  const tasks = [...sim.state.tasks.values()].sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const task of tasks) {
    if (task.type === "craft") {
      const enough = totals.ammo >= sim.state.policies.keepAmmo;
      if (enough && task.status !== "paused" && bagTotal(task.delivered) === 0 && task.progress === 0) {
        task.status = "paused";
        for (const id of [...task.assigned]) releaseWorker(sim, id);
      } else if (!enough && task.status === "paused") task.status = "pending";
    }
    if (task.status === "paused") continue;
    const need = outstanding(task);
    const missing = RESOURCE_IDS.some((id) => (need[id] ?? 0) > 0 && totals[id] <= 0);
    if (missing && deliveredFraction(task) * task.work <= task.progress + 0.01 && task.type !== "farm" && task.type !== "guard") {
      if (task.status !== "blocked") sim.alertOnce(`alert.missingMaterials`, 3000, {}, "warning");
      task.status = "blocked";
    } else if (task.status === "blocked") task.status = "pending";
  }

  // Hand idle automatic survivors the most urgent task they can reach.
  const idle = [...sim.survivors()].filter(
    (e) => !e.survivor.manual && e.survivor.activity.type === "idle" && e.survivor.mounted < 0 && bagTotal(e.survivor.carry) === 0,
  );
  if (idle.length === 0) return;
  const night = isSleepTime(clock.hour);
  for (const task of tasks) {
    if (idle.length === 0) break;
    if (task.status === "blocked" || task.status === "paused" || task.status === "completed") continue;
    if (night && task.type !== "guard") continue;
    if (!isWorkTime(clock.hour) && task.type !== "guard") continue;
    // Towers are manned from dusk to dawn only, freeing hands for daytime work.
    if (task.type === "guard" && !isGuardTime(clock.hour)) continue;
    while (task.assigned.length < task.maxWorkers && idle.length > 0) {
      const site = taskSite(sim, task);
      if (!site) break;
      let bestI = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < idle.length; i++) {
        const e = idle[i];
        const skill =
          task.type === "farm"
            ? e.survivor.skills.farming
            : task.type === "guard"
              ? e.survivor.skills.combat
              : e.survivor.skills.construction;
        const score = skill * 6 - dist(e, site.x, site.y) / 8 + (task.type === "guard" && e.survivor.weapon !== "crowbar" ? 20 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestI = i;
        }
      }
      const e = idle.splice(bestI, 1)[0];
      task.assigned.push(e.id);
      task.status = "active";
      e.survivor.activity = { type: "task", task: task.id, phase: "fetch" };
    }
  }
}

function createAutomaticTasks(sim: Simulation): void {
  const st = sim.state;
  const threshold = st.policies.autoRepairBelow;
  const repairing = new Set<string>();
  for (const t of st.tasks.values()) {
    if (t.type === "repair") repairing.add(t.building >= 0 ? `b${t.building}` : `s${t.structures[0]}`);
  }
  for (const e of sim.structures()) {
    const s = e.structure;
    if (!s.built || !e.health || s.kind === "farm") continue;
    if (e.health.hp < e.health.max * threshold && !repairing.has(`s${e.id}`)) {
      const missing = 1 - e.health.hp / e.health.max;
      const def = STRUCTURES[s.kind];
      const cost: ResourceBag = {};
      for (const id of RESOURCE_IDS) if (def.cost[id]) cost[id] = Math.max(1, Math.ceil((def.cost[id] ?? 0) * missing * 0.5));
      createTask(sim, "repair", { structures: [e.id], cost, work: Math.max(2, def.work * missing * 0.6), maxWorkers: 2 });
    }
  }
  for (const b of st.buildings) {
    if (b.fn === "none" || b.hp <= 0) continue;
    if (b.hp < b.maxHp * threshold && !repairing.has(`b${b.index}`)) {
      const missing = 1 - b.hp / b.maxHp;
      createTask(sim, "repair", { building: b.index, cost: { wood: Math.ceil(20 * missing) }, work: 60 * missing, maxWorkers: 3 });
    }
  }
}

/** Where workers need to stand to work on a task. */
export function taskSite(sim: Simulation, task: Task): Vec2 | null {
  if (task.building >= 0) return sim.city.buildings[task.building].entrance;
  let target: Entity | undefined;
  for (const id of task.structures) {
    const e = sim.state.entities.get(id);
    if (!e) continue;
    target = e;
    if (task.type !== "build" || !e.structure!.built) break;
  }
  if (!target) return null;
  const s = target.structure!;
  const def = STRUCTURES[s.kind];
  const cx = (s.cx + def.size / 2) * sim.grid.cell;
  const cy = (s.cy + def.size / 2) * sim.grid.cell;
  if (s.kind === "farm") return { x: cx, y: cy };
  // Find a free cell touching the footprint.
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = s.cy - 1; y <= s.cy + def.size; y++) {
    for (let x = s.cx - 1; x <= s.cx + def.size; x++) {
      if (!sim.grid.inBounds(x, y)) continue;
      const i = sim.grid.index(x, y);
      if (s.cells.includes(i) || !sim.grid.passableIndex(i, "survivor")) continue;
      const c = sim.grid.centerOf(i);
      const hq = sim.hqEntrance();
      const d = (c.x - hq.x) ** 2 + (c.y - hq.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best ?? sim.grid.nearestPassable(cx, cy, "survivor");
}

function isGuardTime(hour: number): boolean {
  return hour >= 17 || hour < 7;
}

export function runTaskActivity(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  const a = s.activity as Extract<SurvivorComp["activity"], { type: "task" }>;
  const task = sim.state.tasks.get(a.task);
  if (!task || task.status === "completed" || task.status === "paused") {
    releaseFromTask(sim, e);
    return;
  }
  const clock = sim.clock;
  if ((task.type !== "guard" && isSleepTime(clock.hour)) || (task.type === "guard" && !isGuardTime(clock.hour))) {
    releaseFromTask(sim, e);
    return;
  }
  if (s.inside >= 0) exitBuilding(sim, e);
  const site = taskSite(sim, task);
  if (!site) {
    releaseFromTask(sim, e);
    return;
  }

  const goTo = (p: Vec2): boolean => {
    if (dist(e, p.x, p.y) <= 2.6) return true;
    if (sim.arrived(e) && !sim.setDestination(e, p.x, p.y, "survivor")) {
      if (++s.navFails > 3) {
        sim.alertOnce("alert.unreachable", 1200, {}, "warning", p);
        releaseFromTask(sim, e);
      }
    }
    return false;
  };

  switch (a.phase) {
    case "fetch": {
      const need = outstanding(task);
      const canWork = deliveredFraction(task) * task.work > task.progress + 0.05 || bagTotal(task.cost) === 0;
      if (bagTotal(need) <= 0 || (canWork && task.type !== "craft")) {
        a.phase = "work";
        return;
      }
      const node = sim.nearestStorage(e.transform!.x, e.transform!.y, (b) =>
        RESOURCE_IDS.some((id) => (need[id] ?? 0) > 0 && (b.storage[id] ?? 0) > 0),
      );
      if (!node) {
        if (canWork) a.phase = "work";
        else releaseFromTask(sim, e);
        return;
      }
      const ne = sim.city.buildings[node.index].entrance;
      if (!goTo(ne)) return;
      unloadAndRestock(sim, e, node);
      for (const id of RESOURCE_IDS) {
        const want = Math.min(need[id] ?? 0, carrySpace(s));
        if (want <= 0) continue;
        const got = sim.withdraw(id, Math.ceil(want), node);
        addToBag(s.carry, id, got);
        addToBag(task.inTransit, id, got);
        addToBag(sim.state.stats.consumed, id, got);
      }
      a.phase = "deliver";
      sim.stop(e);
      return;
    }
    case "deliver": {
      if (!goTo(site)) return;
      for (const id of RESOURCE_IDS) {
        const v = s.carry[id] ?? 0;
        if (v <= 0) continue;
        addToBag(task.delivered, id, v);
        addToBag(task.inTransit, id, -v);
      }
      s.carry = {};
      a.phase = bagTotal(outstanding(task)) > 0 && deliveredFraction(task) * task.work <= task.progress + 0.05 ? "fetch" : "work";
      return;
    }
    case "haul": {
      const node = sim.nearestStorage(e.transform!.x, e.transform!.y, () => true);
      if (!node) {
        a.phase = "work";
        return;
      }
      if (!goTo(sim.city.buildings[node.index].entrance)) return;
      for (const id of RESOURCE_IDS) if (s.carry[id]) addToBag(sim.state.stats.produced, id, s.carry[id]!);
      unloadAndRestock(sim, e, node);
      a.phase = "work";
      return;
    }
    case "work": {
      if (task.type === "guard") {
        guard(sim, e, task, site);
        return;
      }
      if (!goTo(site)) return;
      sim.stop(e);
      const skill = task.type === "farm" ? s.skills.farming : s.skills.construction;
      const amount = efficiency(e) * skillFactor(skill) * MINUTES_PER_TICK;
      if (task.type === "farm") {
        addToBag(s.carry, "food", amount * BALANCE.farmRate * 10);
        gainXp(s, "farming", MINUTES_PER_TICK * 0.5);
        if ((s.carry.food ?? 0) >= 8) a.phase = "haul";
        return;
      }
      const limit = bagTotal(task.cost) > 0 ? deliveredFraction(task) * task.work : task.work;
      if (task.progress >= limit - 1e-6) {
        a.phase = "fetch";
        return;
      }
      task.progress = Math.min(limit, task.progress + amount);
      gainXp(s, "construction", MINUTES_PER_TICK * 0.5);
      if (sim.state.tick % 15 === 0) sim.emitFx("build", site.x, site.y);
      if (task.type === "build") advanceBuild(sim, task);
      if (task.progress >= task.work - 1e-6) completeTask(sim, task);
      return;
    }
  }
}

function guard(sim: Simulation, e: SurvivorEntity, task: Task, site: Vec2): void {
  const s = e.survivor;
  const tower = sim.state.entities.get(task.structures[0]);
  if (!tower || !tower.structure?.built) {
    releaseFromTask(sim, e);
    return;
  }
  if (s.mounted === tower.id) {
    // Runners keep posted guards supplied.
    if (s.weapon !== "crowbar" && s.ammo < 6 && sim.state.tick % 600 === e.id % 600) s.ammo += sim.withdraw("ammo", 24 - s.ammo);
    // The base is under attack out of this tower's reach: climb down and help.
    if (
      sim.state.policies.autoDefend &&
      sim.state.tick % 50 === e.id % 50 &&
      sim.state.tick - sim.state.lastAttackTick < 30 &&
      !infectedNear(sim, site.x, site.y, WEAPONS[s.weapon].range + TOWER_RANGE_BONUS)
    ) {
      releaseFromTask(sim, e);
      s.activity = { type: "defend" };
    }
    return;
  }
  if (dist(e, site.x, site.y) > 2.6) {
    if (sim.arrived(e)) sim.setDestination(e, site.x, site.y, "survivor");
    return;
  }
  const st = tower.structure;
  const size = STRUCTURES.tower.size;
  s.mounted = tower.id;
  sim.stop(e);
  const t = e.transform!;
  t.x = t.px = (st.cx + size / 2) * sim.grid.cell;
  t.y = t.py = (st.cy + size / 2) * sim.grid.cell;
}

function infectedNear(sim: Simulation, x: number, y: number, radius: number): boolean {
  let found = false;
  sim.infectedHash.query(x, y, radius, (id) => {
    const o = sim.state.entities.get(id);
    if (o?.transform && Math.hypot(o.transform.x - x, o.transform.y - y) <= radius) found = true;
  });
  return found;
}

/** Marks wall segments complete as cumulative work passes their thresholds. */
function advanceBuild(sim: Simulation, task: Task): void {
  let acc = 0;
  for (const id of task.structures) {
    const e = sim.state.entities.get(id);
    if (!e) continue;
    const s = e.structure!;
    const w = STRUCTURES[s.kind].work;
    s.progress = Math.max(0, Math.min(w, task.progress - acc));
    acc += w;
    if (!s.built && s.progress >= w - 1e-6) finishStructure(sim, e);
  }
}

export function finishStructure(sim: Simulation, e: Entity): void {
  const s = e.structure!;
  s.built = true;
  e.health = { hp: STRUCTURES[s.kind].maxHp, max: STRUCTURES[s.kind].maxHp };
  sim.stampStructure(e);
  sim.state.stats.structuresBuilt++;
  // Nudge anyone standing inside the new footprint.
  if (s.kind !== "farm") {
    for (const o of sim.state.entities.values()) {
      if (!o.transform || o.structure) continue;
      if (o.survivor && (o.survivor.inside >= 0 || o.survivor.mounted >= 0)) continue;
      const agent = o.survivor ? "survivor" : "infected";
      if (!sim.grid.passable(o.transform.x, o.transform.y, agent)) {
        const p = sim.grid.nearestPassable(o.transform.x, o.transform.y, agent, 6);
        if (p) {
          o.transform.x = o.transform.px = p.x;
          o.transform.y = o.transform.py = p.y;
        }
        if (o.mover && o.mover.goal) sim.setDestination(o, o.mover.goal.x, o.mover.goal.y, agent);
      }
    }
  }
  if (s.kind === "farm") {
    s.task = createTask(sim, "farm", { structures: [e.id], maxWorkers: 2, work: 1e12 }).id;
  } else if (s.kind === "tower") {
    s.task = createTask(sim, "guard", { structures: [e.id], maxWorkers: 1, work: 1e12 }).id;
  } else s.task = -1;
}

export function completeTask(sim: Simulation, task: Task): void {
  if (task.type === "craft") {
    const ent = sim.city.buildings[task.building].entrance;
    sim.produce("ammo", BALANCE.ammoRecipe.ammo, ent.x, ent.y);
    task.delivered = {};
    task.progress = 0;
    for (const id of [...task.assigned]) {
      const w = sim.state.entities.get(id);
      if (w?.survivor?.activity.type === "task") w.survivor.activity.phase = "fetch";
    }
    return;
  }
  task.status = "completed";
  if (task.type === "build") {
    for (const id of task.structures) {
      const e = sim.state.entities.get(id);
      if (e && !e.structure!.built) finishStructure(sim, e);
    }
    const first = sim.state.entities.get(task.structures[0]);
    const kind = first?.structure?.kind ?? "wall";
    const p = taskSite(sim, task) ?? undefined;
    sim.alert("alert.constructionComplete", { kind }, "success", p);
  } else if (task.type === "convert" && task.convertTo) {
    sim.setBuildingFunction(task.building, task.convertTo);
    sim.state.buildings[task.building].task = -1;
    if (task.convertTo === "workshop") {
      const r = BALANCE.ammoRecipe;
      createTask(sim, "craft", { building: task.building, cost: { metal: r.metal }, work: r.work, maxWorkers: 2 });
    }
    sim.alert("alert.conversionComplete", { fn: task.convertTo }, "success", sim.city.buildings[task.building].entrance);
  } else if (task.type === "repair") {
    if (task.building >= 0) {
      const b = sim.state.buildings[task.building];
      b.hp = b.maxHp;
    }
    for (const id of task.structures) {
      const e = sim.state.entities.get(id);
      if (e?.health) e.health.hp = e.health.max;
    }
  }
  for (const id of [...task.assigned]) releaseWorker(sim, id);
  sim.state.tasks.delete(task.id);
}

/** Cancels a task, refunding delivered materials and removing unbuilt blueprints. */
export function cancelTask(sim: Simulation, task: Task): void {
  for (const id of [...task.assigned]) releaseWorker(sim, id);
  const site = taskSite(sim, task) ?? sim.hqEntrance();
  const refund: ResourceBag = {};
  for (const id of RESOURCE_IDS) {
    const v = (task.delivered[id] ?? 0) * (task.type === "build" ? 1 - task.progress / Math.max(1, task.work) : 1);
    if (v > 0) refund[id] = Math.floor(v);
  }
  sim.deposit(refund, site.x, site.y);
  if (task.type === "build") {
    for (const id of task.structures) {
      const e = sim.state.entities.get(id);
      if (e && !e.structure!.built) {
        sim.grid.releaseStructure(e.structure!.cells, e.id);
        sim.removeEntity(id);
      }
    }
  }
  if (task.type === "convert") sim.state.buildings[task.building].task = -1;
  sim.state.tasks.delete(task.id);
}

function releaseWorker(sim: Simulation, id: EntityId): void {
  const e = sim.state.entities.get(id);
  if (e?.survivor) releaseFromTask(sim, e as SurvivorEntity);
}

export function releaseFromTask(sim: Simulation, e: Entity): void {
  const s = e.survivor!;
  if (s.mounted >= 0) {
    const tower = sim.state.entities.get(s.mounted);
    s.mounted = -1;
    if (tower?.structure) {
      const p = sim.grid.nearestPassable(e.transform!.x, e.transform!.y, "survivor", 6);
      if (p) {
        e.transform!.x = e.transform!.px = p.x;
        e.transform!.y = e.transform!.py = p.y;
      }
    }
  }
  if (s.activity.type !== "task") return;
  const task = sim.state.tasks.get(s.activity.task);
  if (task) {
    task.assigned = task.assigned.filter((x) => x !== e.id);
    if (task.assigned.length === 0 && task.status === "active") task.status = "pending";
    // Goods in transit go back to storage when the worker returns.
    for (const id of RESOURCE_IDS) {
      const v = s.carry[id] ?? 0;
      if (v > 0 && (task.inTransit[id] ?? 0) > 0) addToBag(task.inTransit, id, -Math.min(v, task.inTransit[id]!));
    }
  }
  s.activity = { type: "idle" };
  sim.stop(e);
}

/** Validates and creates blueprints for new structures. */
export function placeStructures(sim: Simulation, kind: keyof typeof STRUCTURES, cells: [number, number][]): Task | null {
  const def = STRUCTURES[kind];
  const ids: EntityId[] = [];
  const cost: ResourceBag = {};
  let work = 0;
  const hq = sim.hqBuilding;
  if (!hq) return null;
  const used = new Set<number>();
  for (const [cx, cy] of cells) {
    const fp = sim.grid.footprint(cx, cy, def.size);
    if (fp.length !== def.size * def.size) continue;
    const ok = fp.every((i) => !used.has(i) && sim.grid.kind[i] === CellKind.Free && sim.grid.structureAt[i] === -1);
    if (!ok) continue;
    // Do not seal off building doors.
    if (kind !== "farm" && touchesEntrance(sim, fp)) continue;
    for (const i of fp) used.add(i);
    const id = sim.newId();
    const e: Entity = {
      id,
      transform: {
        x: (cx + def.size / 2) * sim.grid.cell,
        y: (cy + def.size / 2) * sim.grid.cell,
        px: 0,
        py: 0,
        heading: 0,
      },
      structure: { kind, cx, cy, cells: fp, built: false, progress: 0, task: -1, output: {} },
    };
    e.transform!.px = e.transform!.x;
    e.transform!.py = e.transform!.y;
    sim.state.entities.set(id, e);
    sim.grid.reserveStructure(fp, id);
    ids.push(id);
    for (const r of RESOURCE_IDS) if (def.cost[r]) addToBag(cost, r, def.cost[r]!);
    work += def.work;
  }
  if (ids.length === 0) return null;
  const task = createTask(sim, "build", { structures: ids, cost, work, maxWorkers: Math.min(4, 1 + Math.ceil(ids.length / 4)) });
  for (const id of ids) sim.state.entities.get(id)!.structure!.task = task.id;
  return task;
}

function touchesEntrance(sim: Simulation, cells: number[]): boolean {
  for (const b of sim.city.buildings) {
    const ei = sim.grid.cellOf(b.entrance.x, b.entrance.y);
    if (cells.includes(ei)) return true;
  }
  return false;
}

export function startConversion(sim: Simulation, index: number, fn: keyof typeof BUILDING_FUNCTIONS): Task | null {
  const b = sim.state.buildings[index];
  if (b.fn !== "none" || b.task >= 0 || fn === "none" || fn === "hq") return null;
  if (b.hiddenInfected > 0) return null;
  const def = BUILDING_FUNCTIONS[fn];
  const task = createTask(sim, "convert", { building: index, convertTo: fn, cost: { ...def.cost }, work: def.work, maxWorkers: 3 });
  b.task = task.id;
  b.explored = true;
  return task;
}
