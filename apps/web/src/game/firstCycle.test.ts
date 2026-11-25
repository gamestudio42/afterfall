import { describe, expect, it } from "vitest";
import { createSimulation, deserialize, serialize } from "@afterfall/core";
import { tickAt } from "@afterfall/shared";
import { firstCycleStep } from "./firstCycle";

describe("first-cycle guidance", () => {
  it("follows real progress, survives reload and gives dusk priority over unfinished lessons", () => {
    const sim = createSimulation({ seed: 4242 });
    expect(firstCycleStep(sim, 0)).toBeNull();
    sim.enqueue({ type: "setBase", building: 0 });
    sim.update(0, 0);
    expect(firstCycleStep(sim, 0)).toBe("select");
    expect(firstCycleStep(sim, 4)).toBe("explore");
    const unit = [...sim.survivors()][0];
    unit.survivor.carry = { wood: 2 };
    expect(firstCycleStep(sim, 4)).toBe("deliver");
    unit.survivor.carry = {};
    sim.state.stats.delivered = { wood: 2 };
    expect(firstCycleStep(deserialize(serialize(sim)), 0)).toBe("build");
    sim.state.tick = tickAt(1, 17);
    expect(firstCycleStep(sim, 0)).toBe("return");
    sim.state.tick = tickAt(1, 21);
    expect(firstCycleStep(sim, 0)).toBe("hold");
    sim.state.tick = tickAt(2, 0);
    expect(firstCycleStep(sim, 0)).toBe("hold");
    sim.state.tick = tickAt(2, 6);
    expect(firstCycleStep(sim, 0)).toBeNull();
  });
});
