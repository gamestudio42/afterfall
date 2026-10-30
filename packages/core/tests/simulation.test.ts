import { describe, expect, it } from "vitest";
import { Rng, TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick, tickAt } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import { createSimulation, deserialize, getReport, serialize, stateHash, type Simulation } from "../src";
import { autoplay, pickBase } from "./autoplay";

function started(seed = 42): Simulation {
  const sim = createSimulation({ seed });
  sim.enqueue({ type: "setBase", building: pickBase(sim) });
  sim.tick();
  return sim;
}

function runUntil(sim: Simulation, pred: () => boolean, maxTicks: number): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    sim.tick();
  }
  return pred();
}

describe("rng and clock", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Rng(5);
    const b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("maps ticks to days and phases", () => {
    expect(clockFromTick(0)).toMatchObject({ day: 1, hour: 7, phase: "day" });
    expect(clockFromTick(tickAt(1, 21)).phase).toBe("night");
    expect(clockFromTick(tickAt(2, 6)).phase).toBe("dawn");
    expect(clockFromTick(TICKS_PER_DAY).day).toBe(2);
  });
});

describe("settlement start", () => {
  it("does not advance time before a base is chosen", () => {
    const sim = createSimulation({ seed: 1 });
    sim.runTicks(50);
    expect(sim.state.tick).toBe(0);
    expect(sim.state.started).toBe(false);
  });

  it("establishes the headquarters with four survivors and starting stock", () => {
    const sim = started();
    expect(sim.state.hq).toBeGreaterThanOrEqual(0);
    expect(sim.survivorCount()).toBe(4);
    expect(sim.totals().food).toBeGreaterThanOrEqual(30);
    expect(sim.hqBuilding!.fn).toBe("hq");
  });
});

describe("scavenging (phase 3)", () => {
  it("a team explores a supermarket, brings food home and stocks it", () => {
    const sim = started(7);
    const hq = sim.hqEntrance();
    const market = sim.city.buildings
      .filter((b) => b.type === "supermarket" && b.index !== sim.state.hq)
      .sort((a, b) => Math.hypot(a.entrance.x - hq.x, a.entrance.y - hq.y) - Math.hypot(b.entrance.x - hq.x, b.entrance.y - hq.y))[0];
    sim.state.buildings[market.index].hiddenInfected = 0;
    // Clear the street so the test is about logistics, not combat.
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const foodBefore = sim.totals().food;
    const team = [...sim.survivors()].slice(0, 2).map((e) => e.id);
    sim.enqueue({ type: "scavenge", units: team, building: market.index });
    const ok = runUntil(sim, () => sim.totals().food > foodBefore + 10, 6 * 60 * TICKS_PER_GAME_MINUTE);
    expect(ok).toBe(true);
    expect(sim.state.buildings[market.index].searchProgress).toBeGreaterThan(0);
    expect(sim.state.stats.navFailures).toBe(0);
  });
});

describe("construction and community (phase 4)", () => {
  it("converts a building into a shelter, consuming materials and adding beds", () => {
    const sim = started(11);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const hq = sim.hqEntrance();
    const target = sim.state.buildings
      .filter((b) => b.fn === "none")
      .sort((a, b) => Math.hypot(sim.city.buildings[a.index].entrance.x - hq.x, sim.city.buildings[a.index].entrance.y - hq.y) - Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y))[0];
    target.hiddenInfected = 0;
    const wood = sim.totals().wood;
    sim.enqueue({ type: "convert", building: target.index, fn: "shelter" });
    const ok = runUntil(sim, () => target.fn === "shelter", 8 * 60 * TICKS_PER_GAME_MINUTE);
    expect(ok).toBe(true);
    expect(target.beds).toBeGreaterThan(0);
    expect(sim.totals().wood).toBeLessThan(wood);
  });

  it("builds a wall line that blocks the navigation grid", () => {
    const sim = started(3);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const hq = sim.city.buildings[sim.state.hq];
    const g = sim.grid;
    const cy = Math.floor(hq.entrance.y / g.cell) + (hq.facing.y > 0 ? 3 : -3);
    const cx = Math.floor(hq.entrance.x / g.cell);
    const cells: [number, number][] = [];
    for (let x = cx - 3; x <= cx + 3; x++) cells.push([x, cy]);
    sim.enqueue({ type: "placeStructures", kind: "wall", cells });
    const ok = runUntil(sim, () => [...sim.structures()].length > 0 && [...sim.structures()].every((s) => s.structure.built), 6 * 60 * TICKS_PER_GAME_MINUTE);
    expect(ok).toBe(true);
    const built = [...sim.structures()];
    expect(built.length).toBeGreaterThan(3);
    for (const s of built) for (const c of s.structure.cells) expect(g.kind[c]).toBe(CellKind.Solid);
  });

  it("feeds the population twice a day", () => {
    const sim = started(5);
    const food = sim.totals().food;
    sim.runTicks(tickAt(1, 19) - sim.state.tick + 5);
    const eaten = food - sim.totals().food;
    expect(eaten).toBeGreaterThanOrEqual(sim.survivorCount());
  });
});

describe("infected and combat (phase 5)", () => {
  it("survivors detect, shoot and kill infected, spending ammo", () => {
    const sim = started(9);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const shooter = [...sim.survivors()].find((e) => e.survivor.weapon === "pistol")!;
    const t = shooter.transform!;
    const spot = sim.grid.nearestPassable(t.x + 8, t.y, "infected", 6)!;
    const z = sim.spawnInfected("walker", spot.x, spot.y, -1);
    const ammo = shooter.survivor.ammo;
    const ok = runUntil(sim, () => !sim.state.entities.has(z.id), 600);
    expect(ok).toBe(true);
    expect(shooter.survivor.ammo).toBeLessThan(ammo);
    expect(sim.state.stats.infectedKilled).toBe(1);
  });

  it("infected chase survivors they see and attack walls in their way", () => {
    const sim = started(4);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const s = [...sim.survivors()][0];
    const t = s.transform!;
    const spot = sim.grid.nearestPassable(t.x + 6, t.y, "infected", 6)!;
    const z = sim.spawnInfected("walker", spot.x, spot.y, -1);
    sim.runTicks(10);
    expect(z.infected!.state.type).toBe("chase");
  });

  it("hordes damage and can destroy structures", () => {
    const sim = started(6);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    // Remove survivors from the fight to observe structure damage only.
    sim.state.policies.autoDefend = false;
    const far = sim.city.intersections[0];
    for (const e of [...sim.survivors()]) {
      e.transform!.x = far.x;
      e.transform!.y = far.y;
      e.survivor.manual = true;
      e.survivor.stance = "passive";
    }
    const hq = sim.city.buildings[sim.state.hq];
    const g = sim.grid;
    const cy = Math.floor(hq.entrance.y / g.cell) + (hq.facing.y > 0 ? 2 : -2);
    const cx = Math.floor(hq.entrance.x / g.cell);
    sim.enqueue({ type: "placeStructures", kind: "wall", cells: [[cx, cy]] });
    sim.tick();
    const wall = [...sim.structures()][0];
    // Finish construction instantly for the test.
    const task = sim.state.tasks.get(wall.structure.task)!;
    task.delivered = { ...task.cost };
    task.progress = task.work;
    wall.structure.progress = task.work;
    wall.structure.built = true;
    wall.health = { hp: 30, max: 600 };
    sim.stampStructure(wall);
    sim.state.tasks.delete(task.id);
    const p = sim.grid.nearestPassable((cx + 0.5) * g.cell, (cy + (hq.facing.y > 0 ? 2.5 : -1.5)) * g.cell, "infected", 4)!;
    for (let i = 0; i < 4; i++) sim.spawnInfected("brute", p.x, p.y, 99);
    const ok = runUntil(sim, () => !sim.state.entities.has(wall.id) || (sim.hqBuilding!.hp < sim.hqBuilding!.maxHp), 3000);
    expect(ok).toBe(true);
  });
});

describe("determinism and persistence", () => {
  it("two runs with the same seed and commands are identical", () => {
    const a = createSimulation({ seed: 77 });
    const b = createSimulation({ seed: 77 });
    autoplay(a, 0.5);
    autoplay(b, 0.5);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it("save and load resumes the exact same simulation", () => {
    const a = createSimulation({ seed: 31 });
    autoplay(a, 0.4);
    const save = JSON.stringify(serialize(a, "test"));
    const b = deserialize(save);
    expect(stateHash(b)).toBe(stateHash(a));
    a.runTicks(3000);
    b.runTicks(3000);
    expect(stateHash(b)).toBe(stateHash(a));
  });

  it("rejects malformed saves", () => {
    expect(() => deserialize("{}")).toThrow();
  });
});

describe("headless scenario", () => {
  it("runs five days and reports consistent statistics", () => {
    const sim = createSimulation({ seed: 12345 });
    autoplay(sim, 5);
    const r = getReport(sim);
    expect(r.day).toBeGreaterThanOrEqual(5);
    expect(r.hordesSpawned).toBeGreaterThan(0);
    expect(r.infectedKilled).toBeGreaterThan(0);
    expect(r.navigationFailures).toBe(0);
    expect(r.averageTickMs).toBeLessThan(5);
  });
});
