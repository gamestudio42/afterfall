import { describe, expect, it } from "vitest";
import { Rng, TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick, tickAt } from "@afterfall/shared";
import { CellKind, cityFromOverpass } from "@afterfall/world";
import { FIXTURE_CENTER, syntheticOverpass } from "../../world/tests/fixtures/osm";
import { hqPerimeter } from "../src/systems/infected";
import { SAVE_VERSION, createSimulation, deserialize, getReport, serialize, stateHash, type Simulation } from "../src";
import { enterBuilding } from "../src/systems/util";
import { autoplay, fortRing, pickBase } from "./autoplay";

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

  it("armed survivors inside a settlement building shoot from the windows", () => {
    const sim = started(9);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const shooter = [...sim.survivors()].find((e) => e.survivor.weapon === "pistol")!;
    for (const e of [...sim.survivors()]) if (e !== shooter) sim.removeEntity(e.id);
    // Asleep in the HQ at night, after the first wave has spawned.
    sim.state.tick = tickAt(1, 23);
    enterBuilding(sim, shooter, sim.state.hq, true);
    shooter.survivor.activity = { type: "sleep", building: sim.state.hq, phase: "asleep" };
    const r = sim.city.buildings[sim.state.hq].rect;
    const spot = sim.grid.nearestPassable(r.x + r.w / 2, r.y - 6, "infected", 6) ?? sim.grid.nearestPassable(r.x + r.w / 2, r.y + r.h + 6, "infected", 6)!;
    const z = sim.spawnInfected("walker", spot.x, spot.y, -1);
    z.infected!.state = { type: "idle" };
    const ok = runUntil(sim, () => !sim.state.entities.has(z.id), 600);
    expect(ok).toBe(true);
    expect(shooter.survivor.inside).toBe(sim.state.hq);
  });

  it("the scripted fort ring closes the headquarters off", () => {
    const sim = started(3);
    const ring = fortRing(sim)!;
    expect(ring).not.toBeNull();
    sim.enqueue({ type: "placeStructures", kind: "gate", cells: [ring.gate] });
    sim.enqueue({ type: "placeStructures", kind: "wall", cells: ring.walls });
    sim.tick();
    for (const e of [...sim.structures()]) {
      e.structure.built = true;
      e.health = { hp: 600, max: 600 };
      sim.stampStructure(e);
    }
    // With walls and gates impassable, the HQ door cannot reach the map edge.
    const g = sim.grid;
    const door = sim.hqEntrance();
    const field = g.distanceField([g.cellOf(door.x, door.y)], (i) =>
      g.kind[i] === CellKind.Free || g.kind[i] === CellKind.Soft ? 1 : Infinity,
    );
    expect(field[g.index(0, 0)]).toBe(Infinity);
    expect(field[g.index(g.cols - 1, g.rows - 1)]).toBe(Infinity);
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

describe("events", () => {
  it("resolves a pending event while simulation time is frozen", () => {
    const sim = started();
    const tick = sim.state.tick;
    sim.state.pendingEvent = { eventId: "radio", tick };
    sim.enqueue({ type: "resolveEvent", choice: 0 });

    expect(sim.update(1000, 0)).toBe(0);
    expect(sim.state.pendingEvent).toBeNull();
    expect(sim.state.tick).toBe(tick);
  });
});

describe("blueprint persistence", () => {
  it("keeps blueprint cells reserved after loading", () => {
    const sim = started(3);
    for (const z of [...sim.infected()]) sim.removeEntity(z.id);
    const hq = sim.city.buildings[sim.state.hq];
    const g = sim.grid;
    const cy = Math.floor(hq.entrance.y / g.cell) + (hq.facing.y > 0 ? 3 : -3);
    const cx = Math.floor(hq.entrance.x / g.cell);
    const cells: [number, number][] = [];
    for (let x = cx - 3; x <= cx + 3; x++) cells.push([x, cy]);

    sim.enqueue({ type: "placeStructures", kind: "wall", cells });
    sim.tick();
    const blueprint = [...sim.structures()][0];
    expect(blueprint?.structure.built).toBe(false);

    const loaded = deserialize(JSON.stringify(serialize(sim, "blueprint")));
    const restored = [...loaded.structures()][0];
    expect(restored?.structure.built).toBe(false);
    for (const c of restored.structure.cells) {
      expect(loaded.grid.structureAt[c]).toBe(restored.id);
      expect(loaded.grid.kind[c]).toBe(CellKind.Free);
    }

    // The reservation must survive a load, so a second structure cannot overlap it.
    const before = [...loaded.structures()].length;
    loaded.enqueue({ type: "placeStructures", kind: "wall", cells });
    loaded.tick();
    expect([...loaded.structures()].length).toBe(before);
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

  it("rejects saves from a newer version", () => {
    const save = serialize(started(), "future");
    save.version = SAVE_VERSION + 1;
    save.worldState.version = SAVE_VERSION + 1;
    expect(() => deserialize(save)).toThrow(/newer/);
  });

  it("rejects an imported save without its embedded map", () => {
    const map = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });
    const save = serialize(createSimulation({ seed: map.seed, map }), "no-map");
    delete save.map;
    expect(() => deserialize(save)).toThrow(/map/i);
  });

  it("rejects a saved state that does not match its map", () => {
    const save = serialize(started(), "mismatch");
    save.worldState.hq = 0;
    save.worldState.buildings = save.worldState.buildings.slice(1);
    expect(() => deserialize(save)).toThrow(/match/);
  });

  it("rejects malformed save internals", () => {
    const save = serialize(started(), "bad-internals");
    (save.worldState as unknown as { tasks: unknown }).tasks = {};
    expect(() => deserialize(save)).toThrow();
  });
});

describe("headless scenario", () => {
  it("a scripted player who walls the base in survives five nights (seed 3)", () => {
    const sim = createSimulation({ seed: 3 });
    autoplay(sim, 6, undefined, { fortify: true });
    const r = getReport(sim);
    expect(r.outcome).toBe("victory:survived");
    expect(r.structuresBuilt).toBeGreaterThan(30);
  });

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

describe("real maps (OpenStreetMap)", () => {
  const map = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });

  it("plays a day on an imported map without navigation failures", () => {
    const sim = createSimulation({ seed: map.seed, map });
    autoplay(sim, 1.5);
    const r = getReport(sim);
    expect(sim.state.hq).toBeGreaterThanOrEqual(0);
    expect(r.buildingsSearched).toBeGreaterThan(0);
    expect(r.hordesSpawned).toBeGreaterThan(0);
    expect(r.navigationFailures).toBe(0);
  });

  it("saves and loads with the map embedded", () => {
    const sim = createSimulation({ seed: map.seed, map });
    autoplay(sim, 0.3);
    const save = serialize(sim);
    expect(save.map?.source?.kind).toBe("osm");
    expect(save.mapId.startsWith("osm:")).toBe(true);
    const loaded = deserialize(JSON.parse(JSON.stringify(save)));
    expect(loaded.city.buildings.length).toBe(sim.city.buildings.length);
    expect(stateHash(loaded)).toBe(stateHash(sim));
    sim.runTicks(500);
    loaded.runTicks(500);
    expect(stateHash(loaded)).toBe(stateHash(sim));
  });

  it("infected besiege an imported headquarters from the cells around its outline", () => {
    const sim = createSimulation({ seed: map.seed, map });
    sim.enqueue({ type: "setBase", building: pickBase(sim) });
    sim.tick();
    const cells = hqPerimeter(sim);
    expect(cells.length).toBeGreaterThan(8);
    for (const i of cells) expect(sim.grid.kind[i]).not.toBe(CellKind.Building);
  });
});
