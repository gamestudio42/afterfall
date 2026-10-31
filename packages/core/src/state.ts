import type { BuildingFunction, InfectedKind, ResourceBag, ResourceId, StructureKind, WeaponId } from "@afterfall/content";
import type { Vec2 } from "@afterfall/shared";

export type EntityId = number;

// ---------------------------------------------------------------------------
// Components. An entity is an id plus a bag of optional components; systems
// iterate entities that carry the components they need.
// ---------------------------------------------------------------------------

export interface Transform {
  x: number;
  y: number;
  /** Position at the previous tick, used by the renderer to interpolate. */
  px: number;
  py: number;
  heading: number;
}

export interface Health {
  hp: number;
  max: number;
}

export interface Mover {
  path: Vec2[];
  speed: number;
  /** Final destination of the current path, if any. */
  goal: Vec2 | null;
  stuckTicks: number;
  lastProgressX: number;
  lastProgressY: number;
  gridVersion: number;
}

export type Stance = "aggressive" | "defensive" | "passive";

export type SkillId = "combat" | "construction" | "medicine" | "farming" | "scavenging";
export type Skills = Record<SkillId, number>;

export type SurvivorActivity =
  | { type: "idle" }
  | { type: "move"; x: number; y: number }
  | { type: "scavenge"; building: number; phase: "going" | "clearing" | "searching" | "hauling" | "returning" }
  | { type: "task"; task: number; phase: "fetch" | "deliver" | "work" | "haul" }
  | { type: "sleep"; building: number; phase: "going" | "asleep" }
  | { type: "attack"; target: EntityId }
  | { type: "flee" }
  | { type: "returnBase" }
  | { type: "defend" };

export interface SurvivorComp {
  name: string;
  age: number;
  hunger: number;
  fatigue: number;
  morale: number;
  infection: number;
  infected: boolean;
  skills: Skills;
  xp: Skills;
  weapon: WeaponId;
  ammo: number;
  carry: ResourceBag;
  /** Building index the survivor is inside of, or -1. */
  inside: number;
  /** Tower structure the survivor is posted on, or -1. */
  mounted: EntityId;
  activity: SurvivorActivity;
  /** Manual units ignore the automatic job and sleep schedules. */
  manual: boolean;
  stance: Stance;
  squad: number;
  cooldown: number;
  kills: number;
  /** Consecutive path failures for the current activity. */
  navFails: number;
}

export type InfectedState =
  | { type: "idle" }
  | { type: "wander"; x: number; y: number }
  | { type: "investigate"; x: number; y: number }
  | { type: "chase"; target: EntityId; lastX: number; lastY: number; repathAt: number }
  | { type: "assault" }
  | { type: "retreat" };

export interface InfectedComp {
  kind: InfectedKind;
  state: InfectedState;
  horde: number;
  cooldown: number;
  /** Seconds until the next idle decision. */
  restTimer: number;
  bob: number;
}

export interface StructureComp {
  kind: StructureKind;
  /** Top-left nav cell. */
  cx: number;
  cy: number;
  cells: number[];
  built: boolean;
  /** Worker-minutes accumulated towards completion. */
  progress: number;
  task: number;
  /** For farms and wells: produced resources waiting for pickup. */
  output: ResourceBag;
}

export interface Entity {
  id: EntityId;
  transform?: Transform;
  health?: Health;
  mover?: Mover;
  survivor?: SurvivorComp;
  infected?: InfectedComp;
  structure?: StructureComp;
}

// ---------------------------------------------------------------------------
// World data that is not entity-based.
// ---------------------------------------------------------------------------

export interface BuildingState {
  index: number;
  fn: BuildingFunction;
  hp: number;
  maxHp: number;
  searchProgress: number;
  searchTotal: number;
  remainingLoot: ResourceBag;
  hiddenInfected: number;
  hiddenSurvivors: number;
  /** Stockpile for HQ and storage buildings. */
  storage: ResourceBag;
  storageCapacity: number;
  beds: number;
  occupants: EntityId[];
  /** Task converting this building, or -1. */
  task: number;
  /** Marked by a radio event: extra loot. */
  cache: boolean;
  /** The player has visited or inspected it. */
  explored: boolean;
}

export type TaskType = "build" | "convert" | "repair" | "farm" | "craft" | "guard";

export interface Task {
  id: number;
  type: TaskType;
  /** Structure entity ids (build/repair/farm/guard) */
  structures: EntityId[];
  /** Building index (convert/repair/craft), or -1. */
  building: number;
  convertTo?: BuildingFunction;
  priority: number;
  maxWorkers: number;
  assigned: EntityId[];
  cost: ResourceBag;
  delivered: ResourceBag;
  inTransit: ResourceBag;
  work: number;
  progress: number;
  status: "pending" | "active" | "blocked" | "paused" | "completed";
  createdTick: number;
}

export interface Squad {
  id: number;
  name: string;
  members: EntityId[];
}

export type AlertSeverity = "info" | "warning" | "danger" | "success";

export interface Alert {
  id: number;
  tick: number;
  key: string;
  params: Record<string, string | number>;
  severity: AlertSeverity;
  pos?: Vec2;
}

export interface PendingEvent {
  eventId: string;
  tick: number;
}

export interface Policies {
  autoRepairBelow: number;
  keepAmmo: number;
  recallBeforeDusk: boolean;
  autoDefend: boolean;
}

export interface Stats {
  infectedKilled: number;
  survivorsLost: number;
  survivorsJoined: number;
  structuresBuilt: number;
  buildingsSearched: number;
  produced: ResourceBag;
  consumed: ResourceBag;
  eventsOccurred: number;
  navFailures: number;
  hordesSpawned: number;
}

export interface Outcome {
  type: "victory" | "defeat";
  reason: "survived" | "allDead" | "hqDestroyed";
  tick: number;
}

export interface Horde {
  id: number;
  night: number;
  wave: number;
  spawn: Vec2;
  size: number;
}

export interface Fx {
  seq: number;
  type: "shot" | "melee" | "hit" | "death" | "noise" | "build";
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface GameState {
  version: number;
  seed: number;
  tick: number;
  started: boolean;
  hq: number;
  nextId: number;
  entities: Map<EntityId, Entity>;
  buildings: BuildingState[];
  tasks: Map<number, Task>;
  squads: Squad[];
  alerts: Alert[];
  pendingEvent: PendingEvent | null;
  eventCooldowns: Record<string, number>;
  policies: Policies;
  stats: Stats;
  outcome: Outcome | null;
  hordes: Horde[];
  /** Community morale modifier from events. */
  moraleBonus: number;
  rngState: number;
  /** Last time (tick) the settlement was attacked. */
  lastAttackTick: number;
  log: { tick: number; key: string; params: Record<string, string | number> }[];
}

export type ResourceTotals = Record<ResourceId, number>;
