import { describe, expect, it } from "vitest";
import { tickAt } from "@afterfall/shared";
import { createSimulation, deserialize, placementAt, placementProblem, serialize } from "../src";
import { economySystem } from "../src/systems/economy";
import { unloadAndRestock } from "../src/systems/util";
import { pickBase } from "./autoplay";

function started() {
  const sim = createSimulation({ seed: 4242 });
  sim.enqueue({ type: "setBase", building: pickBase(sim) });
  sim.update(0, 0);
  return sim;
}

describe("delivery receipts", () => {
  it("counts only goods storage accepts and excludes personal ammo withdrawals", () => {
    const sim = started();
    const person = [...sim.survivors()][0];
    const hq = sim.hqBuilding!;
    hq.storage = { ammo: 30 };
    hq.storageCapacity = 33;
    person.survivor.carry = { food: 8 };
    person.survivor.ammo = 0;
    person.survivor.weapon = "pistol";
    unloadAndRestock(sim, person, hq);
    expect(sim.state.delivery?.resources).toEqual({ food: 3 });
    expect(sim.state.stats.delivered).toEqual({ food: 3 });
    expect(sim.state.econ.delivered).toEqual({ food: 3 });
    expect(person.survivor.carry.food).toBe(5);
    expect(person.survivor.ammo).toBe(30);
    expect(sim.state.stats.consumed.ammo ?? 0).toBe(0);
    const restored = deserialize(serialize(sim));
    expect(restored.state.delivery).toEqual(sim.state.delivery);
    expect(restored.state.econ.delivered).toEqual({ food: 3 });
  });

  it("combines nearby deliveries, starts a fresh receipt later and never invents a full-store delivery", () => {
    const sim = started();
    const person = [...sim.survivors()][0];
    const hq = sim.hqBuilding!;
    hq.storage = {};
    person.survivor.carry = { food: 2 };
    unloadAndRestock(sim, person, hq);
    sim.state.tick += 20;
    person.survivor.carry = { wood: 3 };
    unloadAndRestock(sim, person, hq);
    expect(sim.state.delivery?.resources).toEqual({ food: 2, wood: 3 });
    sim.state.tick += 301;
    person.survivor.carry = { metal: 1 };
    unloadAndRestock(sim, person, hq);
    expect(sim.state.delivery?.resources).toEqual({ metal: 1 });
    const receipt = structuredClone(sim.state.delivery);
    hq.storageCapacity = 0;
    person.survivor.carry = { food: 10 };
    unloadAndRestock(sim, person, hq);
    expect(sim.state.delivery).toEqual(receipt);
    expect(person.survivor.carry.food).toBe(10);
  });
});

describe("dawn results", () => {
  it("closes one day's flows and snapshots the treated community without carrying yesterday's waste forward", () => {
    const sim = started();
    const person = [...sim.survivors()][0];
    person.survivor.infected = true;
    person.health!.hp = 20;
    sim.hqBuilding!.storage.medicine = 10;
    sim.state.econ.delivered = { wood: 5 };
    sim.state.econ.wasted = { food: 7 };
    sim.state.econ.consumed = { food: 4 };
    sim.state.stats.survivorsLost = 1;
    sim.state.stats.structuresBuilt = 2;
    sim.state.tick = tickAt(2, 6);
    economySystem(sim);
    const report = sim.state.econ.lastDawn!;
    expect(report).toMatchObject({ day: 2, alive: 4, lost: 1, built: 2, infected: 0, wounded: 1, medicineUsed: 3 });
    expect(report.stock.medicine).toBe(7);
    expect(sim.state.econ.yesterday).toMatchObject({ delivered: { wood: 5 }, wasted: { food: 7 }, consumed: { food: 4 } });
    expect(sim.state.econ.wasted).toEqual({});
    expect(sim.state.econ.consumed.medicine).toBe(3);
    const restored = deserialize(serialize(sim));
    expect(restored.state.econ.lastDawn).toEqual(report);
    restored.state.stats.survivorsLost++;
    restored.state.tick = tickAt(3, 6);
    economySystem(restored);
    expect(restored.state.econ.lastDawn).toMatchObject({ lost: 1, built: 0 });
    expect(restored.state.econ.yesterday.wasted).toEqual({});
    expect(report.day).toBe(2);
  });

  it("loads old v2 saves without feedback fields and does not fabricate daily losses", () => {
    const sim = started();
    const save = serialize(sim);
    delete save.worldState.econ.counters;
    const restored = deserialize(save);
    restored.state.tick = tickAt(2, 6);
    economySystem(restored);
    expect(restored.state.econ.lastDawn).toMatchObject({ lost: null, built: null, day: 2 });
  });
});

describe("explained placement", () => {
  it("uses the same verdict for occupied ground, bounds and doors as the simulation", () => {
    const sim = started();
    const g = sim.grid;
    const door = sim.hqEntrance();
    const index = g.cellOf(door.x, door.y);
    const cells: [number, number][] = [
      [-2, -2],
      [index % g.cols, Math.floor(index / g.cols)],
    ];
    expect(placementProblem(sim, "wall", -2, -2)).toBe("bounds");
    expect(placementProblem(sim, "wall", cells[1][0], cells[1][1])).toBe("entrance");
    for (const [x, y] of cells) expect(placementAt(sim, "wall", x, y)).toBeNull();
    sim.enqueue({ type: "placeStructures", kind: "tower", cells: [[-2, -2]] });
    sim.update(0, 0);
    expect([...sim.structures()]).toHaveLength(0);
    expect(sim.state.alerts.at(-1)?.key).toBe("alert.blueprintRejected");
  });
});
