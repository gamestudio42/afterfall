import { RESOURCE_IDS, bagTotal, type ResourceBag } from "@afterfall/content";
import type { Simulation } from "./simulation";
import type { Task } from "./state";
import { outstanding } from "./systems/tasks";
import { isWorkTime } from "./systems/util";

/** Read-only feedback for finite construction, conversion and repair jobs. */
export function worksiteSummary(sim: Simulation, task: Task) {
  if (task.type !== "build" && task.type !== "convert" && task.type !== "repair") return null;
  const toFetch = outstanding(task);
  const stock = sim.totals();
  const shortfall: ResourceBag = {};
  for (const id of RESOURCE_IDS) {
    const missing = (toFetch[id] ?? 0) - stock[id];
    if (missing > 1e-6) shortfall[id] = missing;
  }
  // A shortfall for the whole job does not mean its supplied portion cannot advance.
  const reason =
    task.status === "paused"
      ? "paused"
      : task.status === "completed"
        ? "completed"
        : task.assigned.length === 0 && !isWorkTime(sim.clock.hour)
          ? "offHours"
          : task.status === "blocked" && bagTotal(shortfall) > 0
            ? "materialsWait"
            : task.assigned.length === 0
              ? "workers"
              : bagTotal(task.inTransit) > 0
                ? "delivery"
                : "active";
  return {
    percent: task.work > 0 ? Math.min(100, Math.max(0, Math.floor((task.progress / task.work) * 100))) : 0,
    toFetch,
    shortfall,
    reason,
  };
}
