import { bagTotal } from "@afterfall/content";
import type { Simulation } from "@afterfall/core";

export type FirstCycleStep = "select" | "explore" | "deliver" | "build" | "building" | "prepare" | "return" | "hold";

/** Derived from saved gameplay, so reloading never resets a completed lesson. */
export function firstCycleStep(sim: Simulation, selected: number): FirstCycleStep | null {
  if (!sim.state.started || sim.state.outcome || (sim.clock.day >= 2 && sim.clock.hour >= 6) || sim.clock.day > 2) return null;
  const hour = sim.clock.hour;
  if (hour >= 20 || hour < 6) return "hold";
  if (hour >= 17) return "return";
  const defenses = [...sim.structures()].filter((e) => ["wall", "gate", "tower"].includes(e.structure.kind));
  if (defenses.some((e) => e.structure.built)) return "prepare";
  if (defenses.length > 0) return "building";
  if (bagTotal(sim.state.stats.delivered ?? {}) > 0) return "build";
  if ([...sim.survivors()].some((e) => bagTotal(e.survivor.carry) > 0 || e.survivor.activity.type === "scavenge")) return "deliver";
  return selected > 0 ? "explore" : "select";
}
