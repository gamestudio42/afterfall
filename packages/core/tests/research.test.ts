import { describe, expect, it } from "vitest";
import { TECHS, researchYield } from "@afterfall/content";
import { TICKS_PER_DAY, clockFromTick } from "@afterfall/shared";
import { carryCapacity } from "../src/systems/util";
import { createSimulation, deserialize, serialize, type Simulation } from "../src";
import { autoplay, pickBase } from "./autoplay";

function started(seed = 42): Simulation {
  const sim = createSimulation({ seed });
  sim.enqueue({ type: "setBase", building: pickBase(sim) });
  sim.tick();
  return sim;
}

/** Grants points through the real API, the way a long game would earn them. */
function grant(sim: Simulation, points: number): void {
  sim.addResearch(points);
}

/**
 * Runs until a dawn has actually been processed. A dawn is defined by the ledger
 * rolling, not by the clock reading: the systems of a tick run on the following
 * call, so watching the clock alone stops one tick early.
 */
function runToDawn(sim: Simulation): void {
  const day = sim.state.econ.day;
  for (let i = 0; i < TICKS_PER_DAY + 10; i++) {
    sim.tick();
    if (sim.state.econ.day !== day) return;
  }
  throw new Error("dawn never ran");
}

describe("research", () => {
  it("is worth points only where records would be", () => {
    expect(researchYield("school")).toBe(3);
    expect(researchYield("hospital")).toBe(3);
    expect(researchYield("police")).toBe(2);
    expect(researchYield("office")).toBe(2);
    expect(researchYield("pharmacy")).toBe(1);
    expect(researchYield("house")).toBe(0);
    expect(researchYield("gasStation")).toBe(0);
  });

  it("only unlocks a node when it is affordable and its prerequisite is met", () => {
    const sim = started();
    grant(sim, 3);
    expect(sim.unlockTech("preserves")).toBe(false); // costs 4
    grant(sim, 1);
    expect(sim.unlockTech("cistern")).toBe(false); // needs preserves first
    expect(sim.unlockTech("preserves")).toBe(true);
    expect(sim.state.research.points).toBe(0);
    expect(sim.unlockTech("preserves")).toBe(false); // already owned
    grant(sim, TECHS.cistern.cost);
    expect(sim.unlockTech("cistern")).toBe(true);
    expect(sim.hasTech("cistern")).toBe(true);
  });

  it("rations widen the pack a survivor can carry", () => {
    const sim = started();
    expect(carryCapacity(sim)).toBe(20);
    grant(sim, TECHS.rations.cost + TECHS.cistern.cost + TECHS.preserves.cost);
    expect(sim.unlockTech("preserves")).toBe(true);
    expect(sim.unlockTech("cistern")).toBe(true);
    expect(sim.unlockTech("rations")).toBe(true);
    expect(carryCapacity(sim)).toBe(30);
  });

  it("preserves measurably cut the food a meal costs", () => {
    const plain = createSimulation({ seed: 7 });
    const teched = createSimulation({ seed: 7 });
    autoplay(plain, 2, undefined, { fortify: true });
    autoplay(teched, 2, undefined, { fortify: true });
    expect(plain.state.stats.consumed.food ?? 0).toBeGreaterThan(0);
    // The tech is applied from the first meal, so the run has to be repeated with it
    // unlocked up front; the seed and the script keep everything else equal.
    const fed = createSimulation({ seed: 7 });
    fed.enqueue({ type: "setBase", building: pickBase(fed, 220) });
    fed.tick();
    grant(fed, TECHS.preserves.cost);
    fed.unlockTech("preserves");
    expect(fed.hasTech("preserves")).toBe(true);
    autoplay(fed, 2, undefined, { fortify: true });
    expect(fed.state.stats.consumed.food ?? 0).toBeLessThan(plain.state.stats.consumed.food ?? 0);
  });

  it("keeps research and the ledger across a save and load", () => {
    const sim = started();
    grant(sim, 9);
    sim.unlockTech("serum");
    sim.produce("food", 5, sim.hqEntrance().x, sim.hqEntrance().y);
    const round = deserialize(serialize(sim, "research"));
    expect(round.state.research.points).toBe(sim.state.research.points);
    expect(round.state.research.unlocked).toEqual(sim.state.research.unlocked);
    expect(round.state.econ.produced.food).toBeCloseTo(sim.state.econ.produced.food ?? 0, 6);
  });
});

describe("the cure", () => {
  it("needs the tech, a standing lab, medicine and points", () => {
    const sim = started();
    expect(sim.startCure()).toBe(false);

    grant(sim, TECHS.serum.cost + TECHS.lab.cost + TECHS.cure.cost + 20);
    expect(sim.unlockTech("serum")).toBe(true);
    expect(sim.unlockTech("lab")).toBe(true);
    expect(sim.unlockTech("cure")).toBe(true);
    expect(sim.startCure()).toBe(false); // no lab yet

    const hq = sim.state.hq;
    const labIndex = sim.state.buildings.findIndex((b) => b.index !== hq && b.fn === "none");
    sim.setBuildingFunction(labIndex, "lab");
    expect(sim.standingLab()?.index).toBe(labIndex);
    expect(sim.cureLab()).toBeNull(); // nothing hosts the project until it starts
    expect(sim.startCure()).toBe(false); // 4 starting medicine, needs 20

    const p = sim.hqEntrance();
    sim.deposit({ medicine: 30 }, p.x, p.y);
    const before = sim.state.research.points;
    expect(sim.startCure()).toBe(true);
    expect(sim.state.research.cure.started).toBe(true);
    expect(sim.state.research.points).toBeLessThan(before);
    expect(sim.totals().medicine).toBeLessThan(30);
  });

  it("advances one dawn per night and wins the campaign", () => {
    const sim = started();
    grant(sim, 40);
    for (const id of ["serum", "lab", "cure"] as const) expect(sim.unlockTech(id)).toBe(true);
    const labIndex = sim.state.buildings.findIndex((b) => b.index !== sim.state.hq && b.fn === "none");
    sim.setBuildingFunction(labIndex, "lab");
    const p = sim.hqEntrance();
    sim.deposit({ medicine: 30 }, p.x, p.y);
    expect(sim.startCure()).toBe(true);

    runToDawn(sim);
    expect(sim.state.research.cure.progress).toBe(1);
    runToDawn(sim);
    runToDawn(sim);
    expect(sim.state.outcome?.type).toBe("victory");
    expect(sim.state.outcome?.reason).toBe("cured");
  });

  it("stalls when its lab is destroyed", () => {
    const sim = started();
    grant(sim, 40);
    for (const id of ["serum", "lab", "cure"] as const) expect(sim.unlockTech(id)).toBe(true);
    const labIndex = sim.state.buildings.findIndex((b) => b.index !== sim.state.hq && b.fn === "none");
    sim.setBuildingFunction(labIndex, "lab");
    const p = sim.hqEntrance();
    sim.deposit({ medicine: 30 }, p.x, p.y);
    expect(sim.startCure()).toBe(true);
    sim.state.buildings[labIndex].hp = 0;
    expect(sim.cureLab()).toBeNull();
    runToDawn(sim);
    expect(sim.state.research.cure.progress).toBe(0);
  });
});

describe("the ledger", () => {
  it("counts today and rolls into yesterday at dawn", () => {
    const sim = started();
    const p = sim.hqEntrance();
    sim.produce("food", 12, p.x, p.y);
    expect(sim.state.econ.produced.food).toBeCloseTo(12, 6);
    expect(sim.state.econ.yesterday.produced.food ?? 0).toBe(0);

    runToDawn(sim);
    expect(sim.state.econ.yesterday.produced.food).toBeCloseTo(12, 6);
    expect(sim.state.econ.produced.food ?? 0).toBe(0);
    expect(sim.state.econ.day).toBe(clockFromTick(sim.state.tick).day);
  });
});
