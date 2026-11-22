import { describe, expect, it } from "vitest";
import { Simulation } from "../src";

function pickBase(sim: Simulation): number {
  const cx = sim.city.width / 2;
  const cy = sim.city.height / 2;
  let best = 0;
  let bd = Infinity;
  for (const b of sim.city.buildings) {
    const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
    if (d < bd) {
      bd = d;
      best = b.index;
    }
  }
  return best;
}

describe("a survivor waiting for work", () => {
  it("takes a few steps and looks round now and then, and stays by the base", () => {
    const sim = new Simulation({ seed: 4242 });
    sim.enqueue({ type: "setBase", building: pickBase(sim) });
    sim.tick();
    for (const e of [...sim.state.entities.values()]) if (e.infected) sim.state.entities.delete(e.id);
    // Nothing to do: no tasks, so every automatic survivor waits.
    sim.state.tasks.clear();
    const hq = sim.hqEntrance();
    const people = [...sim.survivors()].filter((e) => !e.survivor.manual);
    expect(people.length).toBeGreaterThan(0);
    // Gather them on open ground by the door, standing still.
    const spots: { x: number; y: number }[] = [];
    for (let r = 2; spots.length < people.length && r < 20; r += 1.5)
      for (let a = 0; a < Math.PI * 2 && spots.length < people.length; a += 0.5) {
        const x = hq.x + Math.cos(a) * r;
        const y = hq.y + Math.sin(a) * r;
        if (sim.grid.passable(x, y, "survivor") && spots.every((p) => Math.hypot(p.x - x, p.y - y) > 2)) spots.push({ x, y });
      }
    for (const [i, e] of people.entries()) {
      e.transform!.x = e.transform!.px = spots[i].x;
      e.transform!.y = e.transform!.py = spots[i].y;
      e.mover!.path = [];
      e.survivor.activity = { type: "idle" };
    }
    const moved = new Map(people.map((e) => [e.id, 0]));
    const turned = new Map(people.map((e) => [e.id, 0]));
    const ticks = 600;
    for (let i = 0; i < ticks; i++) {
      const before = people.map((e) => ({ x: e.transform!.x, y: e.transform!.y, h: e.transform!.heading }));
      sim.state.tasks.clear();
      sim.tick();
      for (const [j, e] of people.entries()) {
        if (e.survivor.activity.type !== "idle") continue;
        moved.set(e.id, moved.get(e.id)! + Math.hypot(e.transform!.x - before[j].x, e.transform!.y - before[j].y));
        if (e.transform!.heading !== before[j].h) turned.set(e.id, turned.get(e.id)! + 1);
      }
    }
    const idle = people.filter((e) => e.survivor.activity.type === "idle");
    expect(idle.length).toBeGreaterThan(0);
    for (const e of idle) {
      // A minute of waiting: some walking about, not a march, and still at the base.
      expect(moved.get(e.id)!).toBeGreaterThan(1);
      expect(moved.get(e.id)!).toBeLessThan(40);
      expect(turned.get(e.id)!).toBeGreaterThan(0);
      expect(Math.hypot(e.transform!.x - hq.x, e.transform!.y - hq.y)).toBeLessThan(26);
    }
  });
});
