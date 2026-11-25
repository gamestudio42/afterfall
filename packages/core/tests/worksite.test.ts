import { describe, expect, it } from "vitest";
import { tickAt } from "@afterfall/shared";
import { createSimulation, worksiteSummary } from "../src";
import { createTask } from "../src/systems/tasks";

function fixture() {
  const sim = createSimulation({ seed: 4242 });
  sim.enqueue({ type: "setBase", building: 0 });
  sim.update(0, 0);
  const task = createTask(sim, "build", { cost: { wood: 12, metal: 4 }, work: 60 });
  return { sim, task };
}

describe("worksite feedback", () => {
  it("does not count delivered or in-transit materials as uncollected stock needs", () => {
    const { sim, task } = fixture();
    task.delivered = { wood: 3, metal: 1 };
    task.inTransit = { wood: 4, metal: 1 };
    sim.hqBuilding!.storage = { wood: 2, metal: 1 };
    const before = structuredClone(task);
    const summary = worksiteSummary(sim, task)!;
    expect(summary.toFetch).toEqual({ wood: 5, metal: 2 });
    expect(summary.shortfall).toEqual({ wood: 3, metal: 1 });
    expect(task).toEqual(before);
    expect(sim.hqBuilding!.storage).toEqual({ wood: 2, metal: 1 });
  });

  it("keeps a partial job active even when storage cannot fund all remaining work", () => {
    const { sim, task } = fixture();
    task.delivered = { wood: 6, metal: 2 };
    task.status = "active";
    task.assigned = [[...sim.survivors()][0].id];
    task.progress = 15;
    sim.hqBuilding!.storage = {};
    expect(worksiteSummary(sim, task)).toMatchObject({ percent: 25, reason: "active", shortfall: { wood: 6, metal: 2 } });
    task.inTransit = { wood: 2 };
    expect(worksiteSummary(sim, task)?.reason).toBe("delivery");
    task.status = "blocked";
    expect(worksiteSummary(sim, task)?.reason).toBe("materialsWait");
  });

  it("distinguishes worker availability, night hours and an explicit pause", () => {
    const { sim, task } = fixture();
    expect(worksiteSummary(sim, task)?.reason).toBe("workers");
    sim.state.tick = tickAt(1, 20);
    expect(worksiteSummary(sim, task)?.reason).toBe("offHours");
    sim.state.tick = tickAt(2, 6);
    expect(worksiteSummary(sim, task)?.reason).toBe("workers");
    task.status = "paused";
    expect(worksiteSummary(sim, task)?.reason).toBe("paused");
    task.status = "completed";
    expect(worksiteSummary(sim, task)?.reason).toBe("completed");
  });

  it("avoids premature 100 percent and negative needs when a job is nearly finished", () => {
    const { sim, task } = fixture();
    task.progress = 59.99;
    task.delivered = { wood: 14, metal: 4 };
    task.inTransit = { wood: 1 };
    expect(worksiteSummary(sim, task)).toMatchObject({ percent: 99, toFetch: {}, shortfall: {} });
    task.progress = 61;
    expect(worksiteSummary(sim, task)?.percent).toBe(100);
  });

  it("limits finite progress feedback to construction, conversion and repair", () => {
    const { sim, task } = fixture();
    for (const type of ["convert", "repair"] as const) expect(worksiteSummary(sim, { ...task, type })).not.toBeNull();
    for (const type of ["farm", "craft", "guard", "haul"] as const) expect(worksiteSummary(sim, { ...task, type })).toBeNull();
  });
});
