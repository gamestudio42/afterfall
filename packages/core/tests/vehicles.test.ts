import { expect, it } from "vitest";
import { abandonedVehicles, vehicleContains } from "@afterfall/world";
import { createSimulation, serialize, deserialize } from "../src";
import { movementSystem } from "../src/systems/movement";

it("survivors and infected travel around wrecks instead of crossing them", () => {
  const sim = createSimulation({ seed: 4242 });
  sim.enqueue({ type: "setBase", building: 0 });
  sim.tick();
  const car = abandonedVehicles(sim.city)[0];
  const start = sim.grid.nearestPassable(car.x - 7, car.z, "survivor")!;
  const end = sim.grid.nearestPassable(car.x + 7, car.z, "survivor")!;
  const entities = [sim.survivors().next().value!, sim.spawnInfected("walker", start.x, start.y, -1)];
  for (const e of entities) {
    const t = e.transform!;
    t.x = t.px = start.x;
    t.y = t.py = start.y;
    expect(sim.setDestination(e, end.x, end.y, e.survivor ? "survivor" : "infected")).toBe(true);
    for (let i = 0; i < 500 && e.mover!.path.length; i++) {
      movementSystem(sim);
      expect(vehicleContains(car, t.x, t.y)).toBe(false);
    }
    expect(Math.hypot(t.x - end.x, t.y - end.y)).toBeLessThan(1);
  }
});

it("moves a survivor from an old save out of a newly occupied vehicle cell", () => {
  const sim = createSimulation({ seed: 4242 });
  sim.enqueue({ type: "setBase", building: 0 });
  sim.tick();
  const e = sim.survivors().next().value!,
    car = abandonedVehicles(sim.city)[0];
  e.transform!.x = car.x;
  e.transform!.y = car.z;
  const restored = deserialize(serialize(sim));
  const t = restored.state.entities.get(e.id)!.transform!;
  expect(restored.grid.passable(t.x, t.y, "survivor")).toBe(true);
  expect(vehicleContains(car, t.x, t.y)).toBe(false);
});
