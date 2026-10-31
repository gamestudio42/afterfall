import { BALANCE, RESOURCE_IDS, WEAPONS, addToBag, bagTotal, type ResourceId } from "@afterfall/content";
import { TICK_SECONDS } from "@afterfall/shared";
import type { Simulation } from "../simulation";
import type { Entity, SurvivorComp } from "../state";
import { runTaskActivity, releaseFromTask } from "./tasks";
import {
  MINUTES_PER_TICK,
  carrySpace,
  dist,
  efficiency,
  enterBuilding,
  exitBuilding,
  gainXp,
  isSleepTime,
  skillFactor,
  unloadAndRestock,
} from "./util";

type SurvivorEntity = Entity & { survivor: SurvivorComp };

export function survivorSystem(sim: Simulation): void {
  const clock = sim.clock;
  const bedsUsed = countBeds(sim);
  for (const e of [...sim.survivors()]) {
    if (!sim.state.entities.has(e.id)) continue;
    updateNeeds(sim, e);
    if (!sim.state.entities.has(e.id)) continue;
    const s = e.survivor;
    s.cooldown = Math.max(0, s.cooldown - TICK_SECONDS);

    // Self preservation: wounded automatic units fall back to the base.
    if (!s.manual && s.inside < 0 && s.mounted < 0 && e.health!.hp < 35 && s.activity.type !== "flee" && s.activity.type !== "sleep") {
      if (nearestInfected(sim, e, 12) !== null) {
        startFlee(sim, e);
      }
    }

    // The settlement is under attack: nearby automatic survivors rally.
    if (
      sim.state.policies.autoDefend &&
      !s.manual &&
      s.inside < 0 &&
      s.mounted < 0 &&
      sim.state.tick - sim.state.lastAttackTick < 30 &&
      (s.activity.type === "idle" || s.activity.type === "task") &&
      e.health!.hp > 40 &&
      s.stance !== "passive" &&
      (s.ammo > 0 || s.skills.combat >= 2)
    ) {
      const ent = sim.hqEntrance();
      if (dist(e, ent.x, ent.y) < 70) {
        releaseFromTask(sim, e);
        s.activity = { type: "defend" };
      }
    }

    switch (s.activity.type) {
      case "idle":
        idle(sim, e, clock.hour, bedsUsed);
        break;
      case "move":
        if (sim.arrived(e)) s.activity = { type: "idle" };
        break;
      case "returnBase":
      case "flee":
        if (sim.arrived(e)) {
          const node = sim.nearestStorage(e.transform!.x, e.transform!.y, () => true);
          if (node && dist(e, sim.city.buildings[node.index].entrance.x, sim.city.buildings[node.index].entrance.y) < 3) unloadAndRestock(sim, e, node);
          s.activity = { type: "idle" };
          s.manual = false;
        }
        break;
      case "scavenge":
        scavenge(sim, e, clock.hourFloat);
        break;
      case "task":
        runTaskActivity(sim, e);
        break;
      case "sleep":
        sleep(sim, e, clock.hour);
        break;
      case "attack":
        attack(sim, e);
        break;
      case "defend":
        defend(sim, e);
        break;
    }
  }
}

function updateNeeds(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  const h = e.health!;
  const asleep = s.activity.type === "sleep" && s.activity.phase === "asleep";
  if (asleep) {
    s.fatigue = Math.max(0, s.fatigue - (100 / (8 * 60)) * MINUTES_PER_TICK);
    if (s.inside >= 0) h.hp = Math.min(h.max, h.hp + (2 / 60) * MINUTES_PER_TICK);
  } else {
    s.fatigue = Math.min(100, s.fatigue + (100 / (18 * 60)) * MINUTES_PER_TICK);
  }
  if (s.infected) {
    s.infection += (BALANCE.infectionPerHour / 60) * MINUTES_PER_TICK;
    if (s.infection >= 100) {
      turn(sim, e);
      return;
    }
  }
  if (h.hp <= 0) killSurvivor(sim, e, "alert.survivorDied");
}

/** An infected survivor dies and rises as one of them. */
function turn(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  if (s.inside >= 0) exitBuilding(sim, e);
  const { x, y } = e.transform!;
  killSurvivor(sim, e, "alert.survivorTurned");
  sim.spawnInfected("walker", x, y, -1);
}

export function killSurvivor(sim: Simulation, e: SurvivorEntity, key: string): void {
  const s = e.survivor;
  if (s.inside >= 0) {
    const b = sim.state.buildings[s.inside];
    const i = b.occupants.indexOf(e.id);
    if (i >= 0) b.occupants.splice(i, 1);
  }
  releaseFromTask(sim, e);
  for (const sq of sim.state.squads) sq.members = sq.members.filter((m) => m !== e.id);
  sim.state.squads = sim.state.squads.filter((sq) => sq.members.length > 0);
  // Dropped goods are lost; ammo too.
  sim.state.stats.survivorsLost++;
  sim.alert(key, { name: s.name }, "danger", { x: e.transform!.x, y: e.transform!.y });
  sim.emitFx("death", e.transform!.x, e.transform!.y);
  sim.removeEntity(e.id);
}

function countBeds(sim: Simulation): Map<number, number> {
  const used = new Map<number, number>();
  for (const e of sim.survivors()) {
    const a = e.survivor.activity;
    if (a.type === "sleep" && a.building >= 0) used.set(a.building, (used.get(a.building) ?? 0) + 1);
  }
  return used;
}

function idle(sim: Simulation, e: SurvivorEntity, hour: number, bedsUsed: Map<number, number>): void {
  const s = e.survivor;
  if (s.inside >= 0) exitBuilding(sim, e);
  if (s.manual) return;
  if (isSleepTime(hour) && s.mounted < 0) {
    goToSleep(sim, e, bedsUsed);
    return;
  }
  if (bagTotal(s.carry) > 0) {
    returnToBase(sim, e);
    return;
  }
  // Otherwise wait for the task system to hand out work. Idle units drift
  // back towards the base so they are not left out in the open.
  if (sim.arrived(e) && sim.state.tick % 50 === e.id % 50) {
    const ent = sim.hqEntrance();
    if (dist(e, ent.x, ent.y) > 24) sim.setDestination(e, ent.x + sim.rng.range(-4, 4), ent.y + sim.rng.range(-4, 4), "survivor");
  }
}

export function returnToBase(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  if (s.inside >= 0) exitBuilding(sim, e);
  releaseFromTask(sim, e);
  const node = sim.nearestStorage(e.transform!.x, e.transform!.y, () => true);
  const target = node ? sim.city.buildings[node.index].entrance : sim.hqEntrance();
  s.activity = { type: "returnBase" };
  if (!sim.setDestination(e, target.x, target.y, "survivor")) s.activity = { type: "idle" };
}

function startFlee(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  releaseFromTask(sim, e);
  const ent = sim.hqEntrance();
  s.activity = { type: "flee" };
  if (!sim.setDestination(e, ent.x, ent.y, "survivor")) s.activity = { type: "idle" };
  sim.alertOnce(`alert.retreat.${e.id}`, 600, { name: s.name }, "warning", { x: e.transform!.x, y: e.transform!.y });
}

function goToSleep(sim: Simulation, e: SurvivorEntity, bedsUsed: Map<number, number>): void {
  const s = e.survivor;
  let best = -1;
  let bestD = Infinity;
  for (const b of sim.state.buildings) {
    if (b.beds <= 0 || b.hp <= 0) continue;
    if ((bedsUsed.get(b.index) ?? 0) >= b.beds) continue;
    const ent = sim.city.buildings[b.index].entrance;
    const d = dist(e, ent.x, ent.y);
    if (d < bestD) {
      bestD = d;
      best = b.index;
    }
  }
  if (best >= 0) {
    bedsUsed.set(best, (bedsUsed.get(best) ?? 0) + 1);
    const ent = sim.city.buildings[best].entrance;
    s.activity = { type: "sleep", building: best, phase: "going" };
    if (!sim.setDestination(e, ent.x, ent.y, "survivor")) s.activity = { type: "idle" };
  } else {
    // No bed: sleep rough next to the headquarters.
    const ent = sim.hqEntrance();
    s.activity = { type: "sleep", building: -1, phase: "going" };
    sim.setDestination(e, ent.x + sim.rng.range(-5, 5), ent.y + sim.rng.range(1, 5), "survivor");
    sim.alertOnce("alert.noBeds", 6000, {}, "warning");
  }
}

function sleep(sim: Simulation, e: SurvivorEntity, hour: number): void {
  const s = e.survivor;
  const a = s.activity as Extract<SurvivorComp["activity"], { type: "sleep" }>;
  const wake = !isSleepTime(hour);
  if (a.phase === "going") {
    if (wake) {
      s.activity = { type: "idle" };
      return;
    }
    if (!sim.arrived(e)) return;
    if (a.building >= 0) {
      const b = sim.state.buildings[a.building];
      if (b.hp <= 0) {
        s.activity = { type: "idle" };
        return;
      }
      const ent = sim.city.buildings[a.building].entrance;
      if (dist(e, ent.x, ent.y) > 3) {
        if (!sim.setDestination(e, ent.x, ent.y, "survivor")) s.activity = { type: "idle" };
        return;
      }
      unloadAndRestock(sim, e, sim.storageNodes().includes(b) ? b : null);
      enterBuilding(sim, e, a.building, true);
    } else {
      s.morale = Math.max(0, s.morale - 4);
    }
    a.phase = "asleep";
    return;
  }
  // Asleep.
  const underAttack = sim.state.tick - sim.state.lastAttackTick < 60;
  const canFight = e.health!.hp > 40 && s.stance !== "passive" && (s.ammo > 0 || s.skills.combat >= 2);
  // Armed survivors in a settlement building hold it and fire from the windows.
  const holding =
    !wake && s.inside >= 0 && sim.state.buildings[s.inside].fn !== "none" && WEAPONS[s.weapon].usesAmmo &&
    (s.ammo > 0 || sim.storageNodes().includes(sim.state.buildings[s.inside]));
  if (wake || (underAttack && sim.state.policies.autoDefend && canFight && !holding)) {
    if (s.inside >= 0) exitBuilding(sim, e);
    if (!wake) {
      s.activity = { type: "defend" };
      const ent = sim.hqEntrance();
      sim.setDestination(e, ent.x, ent.y, "survivor");
    } else {
      s.activity = { type: "idle" };
    }
  }
}

function scavenge(sim: Simulation, e: SurvivorEntity, hourFloat: number): void {
  const s = e.survivor;
  const a = s.activity as Extract<SurvivorComp["activity"], { type: "scavenge" }>;
  const b = sim.state.buildings[a.building];
  const def = sim.city.buildings[a.building];
  const ent = def.entrance;
  const recall = sim.state.policies.recallBeforeDusk && (hourFloat >= BALANCE.policies.recallHour || hourFloat < 6);
  const depleted = bagTotal(b.remainingLoot) <= 0 && b.hiddenSurvivors <= 0;

  switch (a.phase) {
    case "going": {
      if (!sim.arrived(e)) return;
      if (dist(e, ent.x, ent.y) > 2.5) {
        if (!sim.setDestination(e, ent.x, ent.y, "survivor") && ++s.navFails > 3) s.activity = { type: "idle" };
        return;
      }
      b.explored = true;
      if (b.hiddenInfected > 0) {
        // Disturbing the building draws out whatever hides inside.
        const n = b.hiddenInfected;
        b.hiddenInfected = 0;
        for (let i = 0; i < n; i++) {
          const ix = ent.x + def.facing.x * 1.5 + sim.rng.range(-1.5, 1.5);
          const iy = ent.y + def.facing.y * 1.5 + sim.rng.range(-1.5, 1.5);
          const p = sim.grid.nearestPassable(ix, iy, "infected", 4) ?? ent;
          const z = sim.spawnInfected(sim.rng.chance(0.2) ? "runner" : "walker", p.x, p.y, -1);
          z.infected!.state = { type: "chase", target: e.id, lastX: e.transform!.x, lastY: e.transform!.y, repathAt: 0 };
        }
        sim.alert("alert.ambush", { count: n }, "danger", { x: ent.x, y: ent.y });
        a.phase = "clearing";
        return;
      }
      if (depleted || recall) {
        finishScavenge(sim, e, depleted);
        return;
      }
      enterBuilding(sim, e, a.building, false);
      a.phase = "searching";
      return;
    }
    case "clearing": {
      if (nearestInfected(sim, e, 9) === null) a.phase = "going";
      return;
    }
    case "searching": {
      const rate = BALANCE.searchRate * efficiency(e) * skillFactor(s.skills.scavenging) * MINUTES_PER_TICK;
      const before = Math.floor(b.searchProgress);
      b.searchProgress = Math.min(b.searchTotal, b.searchProgress + rate);
      let reveal = Math.floor(b.searchProgress) - before;
      while (reveal-- > 0 && bagTotal(b.remainingLoot) > 0 && carrySpace(s) > 0.5) {
        const id = sim.rng.weighted(b.remainingLoot as Record<ResourceId, number>);
        // Ammo is light, so it is found in boxes.
        const amount = id === "ammo" ? Math.min(b.remainingLoot.ammo ?? 0, 6) : 1;
        addToBag(b.remainingLoot, id, -amount);
        addToBag(s.carry, id, amount);
        gainXp(s, "scavenging", 1);
      }
      if (b.cache && b.searchProgress >= b.searchTotal * 0.5) {
        b.cache = false;
        addToBag(s.carry, "ammo", 30);
        addToBag(s.carry, "medicine", 3);
        sim.alert("alert.cacheFound", {}, "success", { x: ent.x, y: ent.y });
      }
      if (b.hiddenSurvivors > 0 && b.searchProgress >= b.searchTotal * 0.4) {
        const n = b.hiddenSurvivors;
        b.hiddenSurvivors = 0;
        for (let i = 0; i < n; i++) {
          const ns = sim.spawnSurvivor(ent.x + i * 0.6, ent.y, { weapon: sim.rng.chance(0.3) ? "pistol" : "crowbar" });
          ns.survivor!.activity = { type: "returnBase" };
          const hq = sim.hqEntrance();
          sim.setDestination(ns, hq.x, hq.y, "survivor");
          sim.state.stats.survivorsJoined++;
          sim.alert("alert.survivorFound", { name: ns.survivor!.name }, "success", { x: ent.x, y: ent.y });
        }
      }
      const nowDepleted = bagTotal(b.remainingLoot) <= 0;
      if (nowDepleted && b.searchProgress < b.searchTotal) b.searchProgress = b.searchTotal;
      if (carrySpace(s) <= 0.5 || nowDepleted || recall) {
        if (nowDepleted && b.searchProgress >= b.searchTotal && !sim.state.eventCooldowns[`searched:${b.index}`]) {
          sim.state.eventCooldowns[`searched:${b.index}`] = 1;
          sim.state.stats.buildingsSearched++;
          sim.alert("alert.buildingDepleted", { type: def.type }, "info", { x: ent.x, y: ent.y });
        }
        exitBuilding(sim, e);
        if (bagTotal(s.carry) > 0) {
          a.phase = "hauling";
          const node = sim.nearestStorage(e.transform!.x, e.transform!.y, () => true);
          const target = node ? sim.city.buildings[node.index].entrance : sim.hqEntrance();
          if (!sim.setDestination(e, target.x, target.y, "survivor")) finishScavenge(sim, e, true);
        } else finishScavenge(sim, e, nowDepleted);
      }
      return;
    }
    case "hauling": {
      if (!sim.arrived(e)) return;
      const node = sim.nearestStorage(e.transform!.x, e.transform!.y, () => true);
      if (node) {
        const ne = sim.city.buildings[node.index].entrance;
        if (dist(e, ne.x, ne.y) > 3) {
          if (!sim.setDestination(e, ne.x, ne.y, "survivor")) finishScavenge(sim, e, true);
          return;
        }
      }
      unloadAndRestock(sim, e, node);
      if (!depleted && !recall && bagTotal(s.carry) === 0) {
        a.phase = "going";
        if (!sim.setDestination(e, ent.x, ent.y, "survivor")) finishScavenge(sim, e, false);
      } else {
        finishScavenge(sim, e, depleted);
      }
      return;
    }
    case "returning":
      if (sim.arrived(e)) s.activity = { type: "idle" };
      return;
  }
}

function finishScavenge(sim: Simulation, e: SurvivorEntity, _depleted: boolean): void {
  const s = e.survivor;
  if (s.inside >= 0) exitBuilding(sim, e);
  s.manual = false;
  if (bagTotal(s.carry) > 0) {
    returnToBase(sim, e);
    return;
  }
  s.activity = { type: "scavenge", building: (s.activity as { building: number }).building, phase: "returning" };
  const ent = sim.hqEntrance();
  if (!sim.setDestination(e, ent.x, ent.y, "survivor")) s.activity = { type: "idle" };
}

function attack(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  const a = s.activity as Extract<SurvivorComp["activity"], { type: "attack" }>;
  const target = sim.state.entities.get(a.target);
  if (!target || !target.transform) {
    s.activity = { type: "idle" };
    sim.stop(e);
    return;
  }
  const range = s.weapon === "crowbar" || s.ammo <= 0 ? 1.5 : s.weapon === "rifle" ? 24 : 13;
  const d = dist(e, target.transform.x, target.transform.y);
  const visible = sim.grid.lineOfSight(e.transform!.x, e.transform!.y, target.transform.x, target.transform.y);
  if (d > range || !visible) {
    if (sim.arrived(e) || sim.state.tick % 10 === e.id % 10) sim.setDestination(e, target.transform.x, target.transform.y, "survivor");
  } else {
    sim.stop(e);
  }
}

/** Night defense: hunt infected near the headquarters, then hold the door. */
function defend(sim: Simulation, e: SurvivorEntity): void {
  const s = e.survivor;
  if (sim.state.tick - sim.state.lastAttackTick > 900) {
    s.activity = { type: "idle" };
    return;
  }
  if (sim.state.tick % 10 !== e.id % 10) return;
  const ent = sim.hqEntrance();
  // Out of ammo: run back to the door to restock.
  if (s.weapon !== "crowbar" && s.ammo === 0 && sim.totals().ammo > 0) {
    if (dist(e, ent.x, ent.y) < 3) unloadAndRestock(sim, e, sim.hqBuilding);
    else if (sim.arrived(e) || e.mover!.goal?.x !== ent.x) sim.setDestination(e, ent.x, ent.y, "survivor");
    return;
  }
  const hqRect = sim.city.buildings[sim.state.hq].rect;
  const cx = hqRect.x + hqRect.w / 2;
  const cy = hqRect.y + hqRect.h / 2;
  const radius = Math.hypot(hqRect.w, hqRect.h) / 2 + 30;
  const ranged = s.weapon !== "crowbar" && s.ammo > 0;
  const range = ranged ? 12 : 1.4;
  // Look for attackers around the base, not just around this survivor.
  let target: Entity | null = null;
  let bestD = Infinity;
  sim.infectedHash.query(cx, cy, radius, (id) => {
    const o = sim.state.entities.get(id);
    if (!o?.transform) return;
    if (Math.hypot(o.transform.x - cx, o.transform.y - cy) > radius) return;
    const d = dist(e, o.transform.x, o.transform.y);
    if (d < bestD) {
      bestD = d;
      target = o;
    }
  });
  if (target) {
    const tt = (target as Entity).transform!;
    const inRange = bestD <= range && sim.grid.lineOfSight(e.transform!.x, e.transform!.y, tt.x, tt.y);
    if (inRange) sim.stop(e);
    else {
      // Keep a little distance when armed.
      sim.setDestination(e, tt.x, tt.y, "survivor");
      if (ranged && e.mover!.path.length > 0 && bestD < range + 4) e.mover!.path.length = Math.min(e.mover!.path.length, 1);
    }
  } else if (sim.arrived(e) && dist(e, ent.x, ent.y) > 8) {
    sim.setDestination(e, ent.x, ent.y, "survivor");
  }
}

export function nearestInfected(sim: Simulation, e: Entity, radius: number): Entity | null {
  const t = e.transform!;
  let best: Entity | null = null;
  let bestD = radius * radius;
  sim.infectedHash.query(t.x, t.y, radius, (id) => {
    const o = sim.state.entities.get(id);
    if (!o || !o.transform) return;
    const d = (o.transform.x - t.x) ** 2 + (o.transform.y - t.y) ** 2;
    if (d < bestD || (d === bestD && best && o.id < best.id)) {
      bestD = d;
      best = o;
    }
  });
  return best;
}

export { RESOURCE_IDS };
