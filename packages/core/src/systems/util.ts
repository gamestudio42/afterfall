import { CARRY_CAPACITY, PERSONAL_AMMO_MAX, WEAPONS, bagWeight } from "@afterfall/content";
import type { Simulation } from "../simulation";
import type { BuildingState, Entity, SkillId, SurvivorComp } from "../state";

/** Game minutes advanced by one tick. */
export const MINUTES_PER_TICK = 0.1;

export function skillFactor(level: number): number {
  return 0.7 + level * 0.12;
}

/** Work efficiency from health, fatigue and morale (see GDD §7). */
export function efficiency(e: Entity): number {
  const s = e.survivor!;
  const hp = e.health ? e.health.hp / e.health.max : 1;
  const health = 0.5 + 0.5 * hp;
  const fatigue = 1 - Math.max(0, s.fatigue - 30) / 140;
  const morale = 0.75 + s.morale / 400;
  const hunger = s.hunger >= 70 ? 0.7 : 1;
  return Math.max(0.15, health * fatigue * morale * hunger);
}

export function gainXp(s: SurvivorComp, skill: SkillId, amount: number): void {
  s.xp[skill] += amount;
  const need = 30 * s.skills[skill];
  if (s.xp[skill] >= need && s.skills[skill] < 10) {
    s.xp[skill] -= need;
    s.skills[skill]++;
  }
}

export function carrySpace(s: SurvivorComp): number {
  return CARRY_CAPACITY - bagWeight(s.carry);
}

export function dist(a: Entity, x: number, y: number): number {
  return Math.hypot(a.transform!.x - x, a.transform!.y - y);
}

/** Puts a survivor outside the door of a building. */
export function exitBuilding(sim: Simulation, e: Entity): void {
  const s = e.survivor!;
  if (s.inside < 0) return;
  const b = sim.state.buildings[s.inside];
  const idx = b.occupants.indexOf(e.id);
  if (idx >= 0) b.occupants.splice(idx, 1);
  const ent = sim.city.buildings[s.inside].entrance;
  const t = e.transform!;
  t.x = t.px = ent.x + ((e.id % 3) - 1) * 0.5;
  t.y = t.py = ent.y;
  if (!sim.grid.passable(t.x, t.y, "survivor")) {
    t.x = t.px = ent.x;
    t.y = t.py = ent.y;
  }
  s.inside = -1;
}

export function enterBuilding(sim: Simulation, e: Entity, index: number, asOccupant: boolean): void {
  const s = e.survivor!;
  s.inside = index;
  sim.stop(e);
  if (asOccupant) sim.state.buildings[index].occupants.push(e.id);
  sim.state.buildings[index].explored = true;
}

/** Deposits carried goods and restocks ammo/firearms at a storage node. */
export function unloadAndRestock(sim: Simulation, e: Entity, node: BuildingState | null): void {
  const s = e.survivor!;
  const t = e.transform!;
  if (Object.keys(s.carry).length > 0) {
    const left = sim.deposit(s.carry, t.x, t.y);
    s.carry = left;
    if (Object.keys(left).length > 0) sim.alertOnce("alert.storageFull", 600, {}, "warning");
  }
  if (s.weapon === "crowbar") {
    if (sim.withdraw("firearms", 1, node ?? undefined) > 0) {
      s.weapon = "pistol";
      sim.alert("alert.armed", { name: s.name }, "info");
    }
  }
  if (WEAPONS[s.weapon].usesAmmo && s.ammo < PERSONAL_AMMO_MAX) {
    s.ammo += sim.withdraw("ammo", PERSONAL_AMMO_MAX - s.ammo);
  }
}

export function isSleepTime(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

export function isWorkTime(hour: number): boolean {
  return hour >= 6 && hour < 20;
}
