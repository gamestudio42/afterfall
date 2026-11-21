import { describe, expect, it } from "vitest";
import { SURVIVOR_SPEED, SURVIVOR_WALK_SPEED } from "@afterfall/content";
import { TICK_SECONDS } from "@afterfall/shared";
import { Simulation } from "../src";
import { hurried, movementSystem } from "../src/systems/movement";

/** A survivor sent along an open street, and how far it goes in one tick. */
function stride(setup: (sim: Simulation, id: number) => void): number {
  const sim = new Simulation({ seed: 4242 });
  sim.state.entities.clear();
  const road = sim.city.roads.find((r) => r.horizontal && r.rect.w > 100)!;
  const y = road.rect.y + road.rect.h / 2;
  const e = sim.spawnSurvivor(road.rect.x + 20, y);
  e.survivor!.manual = false;
  e.survivor!.activity = { type: "task", task: 0, phase: "fetch" };
  setup(sim, e.id);
  sim.setDestination(e, road.rect.x + 80, y, "survivor");
  const x0 = e.transform!.x;
  // Movement alone: the job system would drop a task that does not exist.
  (sim as unknown as { rebuildHashes(): void }).rebuildHashes();
  movementSystem(sim);
  return (e.transform!.x - x0) / TICK_SECONDS;
}

describe("a survivor's pace", () => {
  it("walks about a chore with nothing near", () => {
    expect(stride(() => undefined)).toBeCloseTo(SURVIVOR_WALK_SPEED, 1);
  });

  it("jogs with an infected close, or when the player sends it", () => {
    const near = stride((sim, id) => {
      const t = sim.state.entities.get(id)!.transform!;
      sim.spawnInfected("walker", t.x - 15, t.y, -1);
    });
    expect(near).toBeCloseTo(SURVIVOR_SPEED, 1);
    const ordered = stride((sim, id) => {
      sim.state.entities.get(id)!.survivor!.manual = true;
    });
    expect(ordered).toBeCloseTo(SURVIVOR_SPEED, 1);
  });

  it("knows a fight or a retreat is no time to stroll", () => {
    const sim = new Simulation({ seed: 4242 });
    const e = sim.spawnSurvivor(10, 10);
    e.survivor!.manual = false;
    for (const type of ["flee", "returnBase", "defend"] as const) {
      e.survivor!.activity = { type };
      expect(hurried(sim, e)).toBe(true);
    }
    e.survivor!.activity = { type: "idle" };
    sim.state.entities.clear();
    sim.state.entities.set(e.id, e);
    (sim as unknown as { rebuildHashes(): void }).rebuildHashes();
    expect(hurried(sim, e)).toBe(false);
  });
});
