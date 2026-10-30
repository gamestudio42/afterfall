import { EVENTS, RESOURCE_IDS, type EventEffect, type GameEventDefinition } from "@afterfall/content";
import { TICKS_PER_GAME_MINUTE } from "@afterfall/shared";
import type { Simulation } from "../simulation";
import { destroyStructure } from "./infected";

/** Pending events auto-resolve with their last choice after this many ticks. */
export const EVENT_TIMEOUT_TICKS = 120 * TICKS_PER_GAME_MINUTE;

export function eventSystem(sim: Simulation): void {
  const st = sim.state;
  if (st.pendingEvent && st.tick - st.pendingEvent.tick > EVENT_TIMEOUT_TICKS) {
    const def = EVENTS.find((e) => e.id === st.pendingEvent!.eventId);
    resolveEvent(sim, def ? def.choices.length - 1 : 0);
  }
  if (st.tick % TICKS_PER_GAME_MINUTE !== 0) return;
  const clock = sim.clock;
  if (clock.hour !== 9 || clock.minute !== 0 || st.pendingEvent) return;
  if (!sim.rng.chance(0.7)) return;
  const eligible = EVENTS.filter((ev) => eligibleEvent(sim, ev, clock.day));
  if (eligible.length === 0) return;
  const weights: Record<string, number> = {};
  for (const ev of eligible) weights[ev.id] = ev.weight;
  const id = sim.rng.weighted(weights);
  st.pendingEvent = { eventId: id, tick: st.tick };
  st.eventCooldowns[`event:${id}`] = clock.day;
  st.stats.eventsOccurred++;
}

function eligibleEvent(sim: Simulation, ev: GameEventDefinition, day: number): boolean {
  const last = sim.state.eventCooldowns[`event:${ev.id}`];
  if (last !== undefined && day - last < ev.cooldownDays) return false;
  const totals = sim.totals();
  for (const c of ev.conditions) {
    if (c.type === "minDay" && day < c.day) return false;
    if (c.type === "minPopulation" && sim.survivorCount() < c.count) return false;
    if (c.type === "resourceAtLeast" && totals[c.resource] < c.amount) return false;
    if (c.type === "hasStructure" && ![...sim.structures()].some((s) => s.structure.built)) return false;
  }
  return true;
}

export function resolveEvent(sim: Simulation, choiceIndex: number): void {
  const st = sim.state;
  if (!st.pendingEvent) return;
  const def = EVENTS.find((e) => e.id === st.pendingEvent!.eventId);
  st.pendingEvent = null;
  if (!def) return;
  const choice = def.choices[Math.max(0, Math.min(def.choices.length - 1, choiceIndex))];
  const totals = sim.totals();
  if (choice.requires && totals[choice.requires.resource] < choice.requires.amount) {
    // Not affordable: fall back to the last (safe) option.
    applyEffects(sim, def.choices[def.choices.length - 1].effects);
    return;
  }
  applyEffects(sim, choice.effects);
  sim.alert("alert.eventResolved", { event: def.id, choice: choice.key }, "info");
}

function applyEffects(sim: Simulation, effects: EventEffect[]): void {
  for (const fx of effects) {
    switch (fx.type) {
      case "resource": {
        const ent = sim.hqEntrance();
        if (fx.amount >= 0) sim.produce(fx.resource, fx.amount, ent.x, ent.y);
        else sim.consume(fx.resource, -fx.amount);
        break;
      }
      case "addSurvivors": {
        const ent = sim.hqEntrance();
        for (let i = 0; i < fx.count; i++) {
          const infected = fx.infectedChance ? sim.rng.chance(fx.infectedChance) : false;
          const e = sim.spawnSurvivor(ent.x + i * 0.7, ent.y + 1.5, { infected, weapon: sim.rng.chance(0.25) ? "pistol" : "crowbar" });
          sim.state.stats.survivorsJoined++;
          sim.alert("alert.survivorJoined", { name: e.survivor!.name }, "success", ent);
        }
        break;
      }
      case "morale":
        sim.state.moraleBonus += fx.amount;
        for (const e of sim.survivors()) e.survivor.morale = Math.max(0, Math.min(100, e.survivor.morale + fx.amount));
        break;
      case "damageStructures":
        for (const e of [...sim.structures()]) {
          if (!e.structure.built || !e.health) continue;
          e.health.hp -= e.health.max * fx.fraction;
          if (e.health.hp <= 0) destroyStructure(sim, e);
        }
        break;
      case "revealCache": {
        const hq = sim.hqEntrance();
        const candidates = sim.state.buildings
          .filter((b) => b.fn === "none" && b.searchProgress === 0 && !b.cache)
          .map((b) => ({ b, d: Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y) }))
          .filter((c) => c.d > 60)
          .sort((a, b) => a.d - b.d || a.b.index - b.b.index);
        if (candidates.length > 0) {
          const pick = candidates[sim.rng.int(0, Math.min(5, candidates.length - 1))].b;
          pick.cache = true;
          pick.explored = true;
          sim.alert("alert.cacheMarked", { type: sim.city.buildings[pick.index].type }, "info", sim.city.buildings[pick.index].entrance);
        }
        break;
      }
      case "injureRandom": {
        const list = [...sim.survivors()];
        if (list.length > 0) {
          const e = sim.rng.pick(list);
          e.health!.hp = Math.max(5, e.health!.hp - fx.amount);
        }
        break;
      }
    }
  }
}

export { RESOURCE_IDS };
