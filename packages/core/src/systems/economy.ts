import { BALANCE } from "@afterfall/content";
import { TICKS_PER_GAME_MINUTE } from "@afterfall/shared";
import type { Simulation } from "../simulation";

/** Meals, wells, medicine and morale. Runs on game-hour boundaries. */
export function economySystem(sim: Simulation): void {
  if (!sim.state.started || sim.state.tick % TICKS_PER_GAME_MINUTE !== 0) return;
  const clock = sim.clock;
  if (clock.minute !== 0) return;

  // Wells pump water every hour. The cistern tech is a deeper well, not a second one.
  const waterRate = BALANCE.wellRate * (sim.hasTech("cistern") ? 1.6 : 1);
  for (const e of sim.structures()) {
    if (e.structure.kind === "well" && e.structure.built) sim.produce("water", waterRate, e.transform!.x, e.transform!.y);
  }

  if (BALANCE.mealHours.includes(clock.hour)) meal(sim);
  // A standing lab earns research every hour, not once a day: the tree has to open
  // at the pace a player can act on it, and the cure must be reachable before the
  // late hordes, not after them.
  const labs = sim.state.buildings.filter((b) => b.fn === "lab" && b.hp > 0).length;
  const labRate = BALANCE.research.perHourLab * (sim.hasTech("lab") ? 1.5 : 1);
  if (labs > 0) sim.addResearch(labRate * labs);
  if (clock.hour === 6) dawn(sim);

  const totals = sim.totals();
  const pop = sim.survivorCount();
  if (pop > 0 && totals.food < pop * 2) sim.alertOnce("alert.foodLow", 6000, {}, "warning");
  if (pop > 0 && totals.water < pop * 2) sim.alertOnce("alert.waterLow", 6000, {}, "warning");
  let idle = 0;
  for (const e of sim.survivors()) if (e.survivor.activity.type === "idle" && !e.survivor.manual) idle++;
  if (clock.hour >= 8 && clock.hour < 17 && idle >= 2) sim.alertOnce("alert.idleWorkers", 9000, { count: idle }, "info");
  if (clock.hour === BALANCE.policies.recallHour - 1) sim.alertOnce("alert.duskSoon", 6000, {}, "warning");
}

function meal(sim: Simulation): void {
  let hungry = 0;
  for (const e of sim.survivors()) {
    const s = e.survivor;
    // Preserves: the same meal out of a smaller can.
    const needFood = BALANCE.mealFood * (sim.hasTech("preserves") ? 0.7 : 1);
    const food = sim.consume("food", needFood);
    const water = sim.consume("water", BALANCE.mealWater);
    if (food >= needFood && water >= BALANCE.mealWater) {
      s.hunger = Math.max(0, s.hunger - 50);
      s.morale = Math.min(100, s.morale + 1);
    } else {
      hungry++;
      s.hunger = Math.min(100, s.hunger + (food < needFood ? 30 : 15) + (water < BALANCE.mealWater ? 20 : 0));
      s.morale = Math.max(0, s.morale - 6);
      if (s.hunger >= 100) e.health!.hp -= 12;
    }
  }
  if (hungry > 0) sim.alert("alert.hungry", { count: hungry }, "danger");
}

function dawn(sim: Simulation): void {
  const night = sim.clock.day - 1;
  rollLedger(sim);
  researchAtDawn(sim);
  if (night >= 1) sim.alert("alert.dawn", { night, alive: sim.survivorCount() }, "success");
  // Medicine: cure infections first, then treat the wounded. Serum halves the dose.
  const dose = sim.hasTech("serum") ? 1 : 2;
  for (const e of sim.survivors()) {
    const s = e.survivor;
    if (s.infected && sim.totals().medicine >= dose) {
      sim.consume("medicine", dose);
      s.infected = false;
      s.infection = 0;
      sim.alert("alert.cured", { name: s.name }, "success");
    }
  }
  for (const e of sim.survivors()) {
    const h = e.health!;
    if (h.hp < h.max * 0.6 && sim.consume("medicine", 1) > 0) h.hp = Math.min(h.max, h.hp + 35);
  }
  // Morale drifts towards a baseline shaped by events and comfort.
  for (const e of sim.survivors()) {
    const s = e.survivor;
    const target = 60 + sim.state.moraleBonus - s.hunger * 0.3;
    s.morale += (target - s.morale) * 0.3;
    s.morale = Math.max(0, Math.min(100, s.morale));
  }
  sim.state.moraleBonus *= 0.6;
}

/** Rolls today's flows into yesterday, for the ledger panel. */
function rollLedger(sim: Simulation): void {
  const econ = sim.state.econ;
  econ.yesterday = { produced: { ...econ.produced }, consumed: { ...econ.consumed } };
  econ.produced = {};
  econ.consumed = {};
  econ.day = sim.clock.day;
}

/**
 * Research income and the cure clock. A standing lab earns points every dawn; the
 * cure advances one step per dawn while its lab stands, so the endgame is a
 * building the player has to defend rather than a timer they can ignore.
 */
function researchAtDawn(sim: Simulation): void {
  const r = sim.state.research;
  if (!r.cure.started) return;
  const lab = sim.cureLab();
  if (!lab) {
    sim.alertOnce("alert.cureStalled", 6000, {}, "warning");
    return;
  }
  r.cure.progress = Math.min(BALANCE.research.cureDawns, r.cure.progress + 1);
  sim.alert("alert.cureProgress", { progress: r.cure.progress, total: BALANCE.research.cureDawns }, "success");
}
