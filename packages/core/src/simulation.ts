import {
  BALANCE,
  BUILDING_FUNCTIONS,
  BUILDING_TYPES,
  FIRST_NAMES,
  HQ_BEDS,
  HQ_STORAGE,
  INFECTED,
  LAST_NAMES,
  RESOURCE_IDS,
  SURVIVOR_MAX_HEALTH,
  SURVIVOR_SPEED,
  addToBag,
  bagTotal,
  type BuildingFunction,
  type InfectedKind,
  type ResourceBag,
  type ResourceId,
  type WeaponId,
} from "@afterfall/content";
import {
  Rng,
  SIMULATION_TICK_MS,
  TICKS_PER_DAY,
  clockFromTick,
  deriveSeed,
  type GameClock,
  type Vec2,
} from "@afterfall/shared";
import { NavGrid, SpatialHash, generateCity, type Agent, type CityMap, type CityOptions } from "@afterfall/world";
import { applyCommand, type Command } from "./commands";
import type {
  AlertSeverity,
  BuildingState,
  Entity,
  EntityId,
  Fx,
  GameState,
  ResourceTotals,
  Skills,
} from "./state";
import { infectedSystem, InfectedFields } from "./systems/infected";
import { movementSystem } from "./systems/movement";
import { survivorSystem } from "./systems/survivors";
import { taskSystem } from "./systems/tasks";
import { combatSystem } from "./systems/combat";
import { economySystem } from "./systems/economy";
import { eventSystem } from "./systems/events";
import { outcomeSystem } from "./systems/outcome";

export const SAVE_VERSION = 1;
/** Upper bound on ticks processed per update call, to avoid spiral of death. */
const MAX_TICKS_PER_UPDATE = 80;

export interface SimulationOptions {
  seed: number;
  city?: Omit<CityOptions, "seed">;
  /** A ready-made map (an imported real place) instead of a generated city. */
  map?: CityMap;
}

export class Simulation {
  readonly city: CityMap;
  readonly grid: NavGrid;
  state: GameState;
  rng: Rng;
  readonly survivorHash = new SpatialHash(8);
  readonly infectedHash = new SpatialHash(8);
  readonly fields: InfectedFields;
  /** Transient visual effects; not saved. */
  fx: Fx[] = [];
  fxSeq = 0;
  private commands: Command[] = [];
  private accumulator = 0;
  /** Rolling average of tick cost in ms (diagnostics). */
  tickMs = 0;

  constructor(opts: SimulationOptions, restored?: GameState) {
    this.city = opts.map ?? generateCity({ seed: opts.seed, ...opts.city });
    this.grid = NavGrid.fromCity(this.city);
    this.fields = new InfectedFields(this);
    if (restored) {
      this.state = restored;
      this.rng = new Rng(0);
      this.rng.state = restored.rngState;
      for (const e of restored.entities.values()) {
        const s = e.structure;
        if (s && (s.built || s.kind === "farm")) this.stampStructure(e);
      }
    } else {
      this.rng = new Rng(deriveSeed(opts.seed, "sim"));
      this.state = this.createInitialState(opts.seed);
      this.spawnInitialInfected();
    }
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  enqueue(cmd: Command): void {
    this.commands.push(cmd);
  }

  /** Advances by real elapsed time. Returns ticks processed. */
  update(realDtMs: number, speed: number): number {
    if (speed <= 0) return 0;
    this.accumulator += realDtMs * speed;
    let n = 0;
    while (this.accumulator >= SIMULATION_TICK_MS && n < MAX_TICKS_PER_UPDATE * Math.max(1, speed / 2)) {
      this.tick();
      this.accumulator -= SIMULATION_TICK_MS;
      n++;
    }
    if (this.accumulator > SIMULATION_TICK_MS * 4) this.accumulator = SIMULATION_TICK_MS;
    return n;
  }

  /** Interpolation factor between the previous and current tick. */
  get alpha(): number {
    return Math.min(1, this.accumulator / SIMULATION_TICK_MS);
  }

  get clock(): GameClock {
    return clockFromTick(this.state.tick);
  }

  tick(): void {
    const t0 = performance.now();
    const cmds = this.commands;
    this.commands = [];
    for (const c of cmds) applyCommand(this, c);
    if (!this.state.started || (this.state.outcome && this.state.outcome.type === "defeat")) {
      this.tickMs = this.tickMs * 0.95 + (performance.now() - t0) * 0.05;
      return;
    }
    for (const e of this.state.entities.values()) {
      const t = e.transform;
      if (t) {
        t.px = t.x;
        t.py = t.y;
      }
    }
    this.rebuildHashes();
    taskSystem(this);
    survivorSystem(this);
    infectedSystem(this);
    movementSystem(this);
    combatSystem(this);
    economySystem(this);
    eventSystem(this);
    this.state.tick++;
    outcomeSystem(this);
    this.state.rngState = this.rng.state;
    this.tickMs = this.tickMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  runTicks(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  runForDays(days: number): void {
    this.runTicks(Math.round(days * TICKS_PER_DAY));
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private createInitialState(seed: number): GameState {
    const lootRng = new Rng(deriveSeed(seed, "loot"));
    const buildings: BuildingState[] = this.city.buildings.map((b) => {
      const def = BUILDING_TYPES[b.type];
      const area = b.area * b.floors;
      const units = Math.max(6, Math.round((area / 100) * def.lootDensity * lootRng.range(0.6, 1.25)));
      const loot: ResourceBag = {};
      for (let i = 0; i < units; i++) addToBag(loot, lootRng.weighted(def.loot as Record<ResourceId, number>), 1);
      return {
        index: b.index,
        fn: "none",
        hp: 0,
        maxHp: 0,
        searchProgress: 0,
        searchTotal: units,
        remainingLoot: loot,
        hiddenInfected: lootRng.int(def.infected[0], def.infected[1]),
        hiddenSurvivors: lootRng.chance(def.survivorChance) ? lootRng.int(1, 2) : 0,
        storage: {},
        storageCapacity: 0,
        beds: 0,
        occupants: [],
        task: -1,
        cache: false,
        explored: false,
      };
    });
    return {
      version: SAVE_VERSION,
      seed,
      tick: 0,
      started: false,
      hq: -1,
      nextId: 1,
      entities: new Map(),
      buildings,
      tasks: new Map(),
      squads: [],
      alerts: [],
      pendingEvent: null,
      eventCooldowns: {},
      policies: {
        autoRepairBelow: BALANCE.policies.autoRepairBelow,
        keepAmmo: BALANCE.policies.keepAmmo,
        recallBeforeDusk: true,
        autoDefend: true,
      },
      stats: {
        infectedKilled: 0,
        survivorsLost: 0,
        survivorsJoined: 0,
        structuresBuilt: 0,
        buildingsSearched: 0,
        produced: {},
        consumed: {},
        eventsOccurred: 0,
        navFailures: 0,
        hordesSpawned: 0,
      },
      outcome: null,
      hordes: [],
      moraleBonus: 0,
      rngState: this.rng.state,
      lastAttackTick: -99999,
      log: [],
    };
  }

  private spawnInitialInfected(): void {
    const n = BALANCE.wanderersAtStart;
    for (let i = 0; i < n; i++) {
      const p = this.randomRoadPoint();
      this.spawnInfected(this.rng.chance(0.15) ? "runner" : "walker", p.x, p.y, -1);
    }
  }

  randomRoadPoint(): Vec2 {
    for (let tries = 0; tries < 50; tries++) {
      const road = this.rng.pick(this.city.roads);
      let x: number;
      let y: number;
      if (road.path) {
        const i = this.rng.int(1, road.path.length - 1);
        const a = road.path[i - 1];
        const b = road.path[i];
        const t = this.rng.next();
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
      } else {
        x = road.rect.x + this.rng.range(1, road.rect.w - 1);
        y = road.rect.y + this.rng.range(1, road.rect.h - 1);
      }
      if (this.grid.passable(x, y, "infected")) return { x, y };
    }
    return { x: this.city.intersections[0].x, y: this.city.intersections[0].y };
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  newId(): EntityId {
    return this.state.nextId++;
  }

  spawnSurvivor(x: number, y: number, opts: { weapon?: WeaponId; infected?: boolean } = {}): Entity {
    const rng = this.rng;
    const skill = (): number => rng.int(1, 3);
    const skills: Skills = { combat: skill(), construction: skill(), medicine: skill(), farming: skill(), scavenging: skill() };
    // One random specialty per survivor.
    const spec = rng.pick(Object.keys(skills) as (keyof Skills)[]);
    skills[spec] += 2;
    const e: Entity = {
      id: this.newId(),
      transform: { x, y, px: x, py: y, heading: 0 },
      health: { hp: SURVIVOR_MAX_HEALTH, max: SURVIVOR_MAX_HEALTH },
      mover: { path: [], speed: SURVIVOR_SPEED, goal: null, stuckTicks: 0, lastProgressX: x, lastProgressY: y, gridVersion: 0 },
      survivor: {
        name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        age: rng.int(17, 64),
        hunger: 0,
        fatigue: 10,
        morale: 60,
        infection: opts.infected ? 5 : 0,
        infected: !!opts.infected,
        skills,
        xp: { combat: 0, construction: 0, medicine: 0, farming: 0, scavenging: 0 },
        weapon: opts.weapon ?? "crowbar",
        ammo: opts.weapon && opts.weapon !== "crowbar" ? 15 : 0,
        carry: {},
        inside: -1,
        mounted: -1,
        activity: { type: "idle" },
        manual: false,
        stance: "defensive",
        squad: -1,
        cooldown: 0,
        kills: 0,
        navFails: 0,
      },
    };
    this.state.entities.set(e.id, e);
    return e;
  }

  spawnInfected(kind: InfectedKind, x: number, y: number, horde: number): Entity {
    const def = INFECTED[kind];
    const e: Entity = {
      id: this.newId(),
      transform: { x, y, px: x, py: y, heading: this.rng.range(0, Math.PI * 2) },
      health: { hp: def.hp, max: def.hp },
      mover: { path: [], speed: def.speed, goal: null, stuckTicks: 0, lastProgressX: x, lastProgressY: y, gridVersion: 0 },
      infected: {
        kind,
        state: horde >= 0 ? { type: "assault" } : { type: "idle" },
        horde,
        cooldown: 0,
        restTimer: this.rng.range(0, 8),
        bob: this.rng.range(0, Math.PI * 2),
      },
    };
    this.state.entities.set(e.id, e);
    return e;
  }

  removeEntity(id: EntityId): void {
    this.state.entities.delete(id);
  }

  *survivors(): Generator<Entity & { survivor: NonNullable<Entity["survivor"]> }> {
    for (const e of this.state.entities.values()) if (e.survivor) yield e as never;
  }

  *infected(): Generator<Entity & { infected: NonNullable<Entity["infected"]> }> {
    for (const e of this.state.entities.values()) if (e.infected) yield e as never;
  }

  *structures(): Generator<Entity & { structure: NonNullable<Entity["structure"]> }> {
    for (const e of this.state.entities.values()) if (e.structure) yield e as never;
  }

  survivorCount(): number {
    let n = 0;
    for (const _ of this.survivors()) n++;
    return n;
  }

  private rebuildHashes(): void {
    this.survivorHash.clear();
    this.infectedHash.clear();
    for (const e of this.state.entities.values()) {
      if (!e.transform) continue;
      if (e.survivor && e.survivor.inside < 0) this.survivorHash.insert(e.id, e.transform.x, e.transform.y);
      else if (e.infected) this.infectedHash.insert(e.id, e.transform.x, e.transform.y);
    }
  }

  /** Marks the nav grid cells of a structure according to its definition. */
  stampStructure(e: Entity): void {
    const s = e.structure!;
    const kind = s.kind === "farm" ? 4 : s.kind === "gate" ? 3 : 2;
    this.grid.setStructure(s.cells, kind, e.id);
  }

  // -------------------------------------------------------------------------
  // Settlement and storage
  // -------------------------------------------------------------------------

  get hqBuilding(): BuildingState | null {
    return this.state.hq >= 0 ? this.state.buildings[this.state.hq] : null;
  }

  hqEntrance(): Vec2 {
    const hq = this.state.hq;
    return hq >= 0 ? this.city.buildings[hq].entrance : { x: this.city.width / 2, y: this.city.height / 2 };
  }

  setBuildingFunction(index: number, fn: BuildingFunction): void {
    const b = this.state.buildings[index];
    const def = this.city.buildings[index];
    const fdef = BUILDING_FUNCTIONS[fn];
    const area = (def.area * def.floors) / 100;
    b.fn = fn;
    b.maxHp = fdef.maxHp;
    b.hp = fdef.maxHp;
    if (fn === "hq") {
      b.beds = HQ_BEDS;
      b.storageCapacity = HQ_STORAGE;
    } else {
      b.beds = Math.max(fdef.bedsPer100m2 > 0 ? 2 : 0, Math.min(16, Math.floor(area * fdef.bedsPer100m2)));
      b.storageCapacity = Math.min(1500, Math.floor(area * fdef.storagePer100m2));
    }
  }

  storageNodes(): BuildingState[] {
    return this.state.buildings.filter((b) => b.storageCapacity > 0 && b.hp > 0);
  }

  totals(): ResourceTotals {
    const t = {} as ResourceTotals;
    for (const id of RESOURCE_IDS) t[id] = 0;
    for (const b of this.state.buildings) {
      if (b.storageCapacity <= 0) continue;
      for (const id of RESOURCE_IDS) t[id] += b.storage[id] ?? 0;
    }
    return t;
  }

  storageUsed(b: BuildingState): number {
    return bagTotal(b.storage);
  }

  /** Total storage capacity and use, for the HUD. */
  storageSummary(): { used: number; capacity: number } {
    let used = 0;
    let capacity = 0;
    for (const b of this.storageNodes()) {
      used += this.storageUsed(b);
      capacity += b.storageCapacity;
    }
    return { used, capacity };
  }

  nearestStorage(x: number, y: number, filter: (b: BuildingState) => boolean): BuildingState | null {
    let best: BuildingState | null = null;
    let bestD = Infinity;
    for (const b of this.storageNodes()) {
      if (!filter(b)) continue;
      const e = this.city.buildings[b.index].entrance;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Adds resources to storage nodes (nearest first). Returns what did not fit. */
  deposit(bag: ResourceBag, x: number, y: number): ResourceBag {
    const left: ResourceBag = { ...bag };
    const nodes = this.storageNodes()
      .map((b) => ({ b, d: (this.city.buildings[b.index].entrance.x - x) ** 2 + (this.city.buildings[b.index].entrance.y - y) ** 2 }))
      .sort((a, b) => a.d - b.d || a.b.index - b.b.index);
    for (const { b } of nodes) {
      for (const id of RESOURCE_IDS) {
        const amount = left[id] ?? 0;
        if (amount <= 0) continue;
        const space = b.storageCapacity - this.storageUsed(b);
        const put = Math.min(space, amount);
        if (put <= 0) continue;
        addToBag(b.storage, id, put);
        addToBag(left, id, -put);
      }
    }
    return left;
  }

  /** Removes up to `amount` of a resource from storage. Returns amount taken. */
  withdraw(id: ResourceId, amount: number, from?: BuildingState): number {
    let taken = 0;
    const nodes = from ? [from] : this.storageNodes();
    for (const b of nodes) {
      const have = b.storage[id] ?? 0;
      const take = Math.min(have, amount - taken);
      if (take > 0) {
        addToBag(b.storage, id, -take);
        taken += take;
      }
      if (taken >= amount) break;
    }
    return taken;
  }

  consume(id: ResourceId, amount: number): number {
    const got = this.withdraw(id, amount);
    addToBag(this.state.stats.consumed, id, got);
    return got;
  }

  produce(id: ResourceId, amount: number, x: number, y: number): void {
    addToBag(this.state.stats.produced, id, amount);
    this.deposit({ [id]: amount }, x, y);
  }

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  /** Plans a path for an entity. Returns false (and counts a failure) if unreachable. */
  setDestination(e: Entity, x: number, y: number, agent: Agent): boolean {
    const t = e.transform!;
    const m = e.mover!;
    const res = this.grid.findPath(t.x, t.y, x, y, agent, agent === "infected" ? 6000 : 60000);
    if (!res) {
      m.path = [];
      m.goal = null;
      if (agent === "survivor") this.state.stats.navFailures++;
      return false;
    }
    m.path = res.points;
    m.goal = { x, y };
    m.stuckTicks = 0;
    m.gridVersion = this.grid.version;
    return true;
  }

  stop(e: Entity): void {
    if (e.mover) {
      e.mover.path = [];
      e.mover.goal = null;
    }
  }

  arrived(e: Entity): boolean {
    return !!e.mover && e.mover.path.length === 0;
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  alert(key: string, params: Record<string, string | number> = {}, severity: AlertSeverity = "info", pos?: Vec2): void {
    const a = { id: this.state.tick * 100 + this.state.alerts.length, tick: this.state.tick, key, params, severity, pos };
    this.state.alerts.push(a);
    if (this.state.alerts.length > 40) this.state.alerts.splice(0, this.state.alerts.length - 40);
    this.state.log.push({ tick: this.state.tick, key, params });
    if (this.state.log.length > 400) this.state.log.splice(0, this.state.log.length - 400);
  }

  /** Raises an alert at most once per `cooldownTicks` for the same key. */
  alertOnce(key: string, cooldownTicks: number, params: Record<string, string | number> = {}, severity: AlertSeverity = "warning", pos?: Vec2): void {
    const last = this.state.eventCooldowns[`alert:${key}`] ?? -Infinity;
    if (this.state.tick - last < cooldownTicks) return;
    this.state.eventCooldowns[`alert:${key}`] = this.state.tick;
    this.alert(key, params, severity, pos);
  }

  emitFx(type: Fx["type"], x: number, y: number, tx = x, ty = y): void {
    this.fx.push({ seq: ++this.fxSeq, type, x, y, tx, ty });
    if (this.fx.length > 300) this.fx.splice(0, this.fx.length - 300);
  }
}
