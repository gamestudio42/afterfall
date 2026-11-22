import { describe, expect, it } from "vitest";
import { INFECTED, INFECTED_PACE_SPREAD } from "@afterfall/content";
import { Simulation } from "../src";

describe("infected pace", () => {
  it("spreads a horde's pace about its kind's speed without moving the mean", () => {
    const sim = new Simulation({ seed: 77 });
    const speeds = Array.from({ length: 200 }, () => sim.spawnInfected("walker", 50, 50, -1).mover!.speed);
    const base = INFECTED.walker.speed;
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(base * (1 - INFECTED_PACE_SPREAD) - 1e-9);
      expect(v).toBeLessThanOrEqual(base * (1 + INFECTED_PACE_SPREAD) + 1e-9);
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(mean / base).toBeCloseTo(1, 2);
    // Not a parade: bodies spawned together do not share a pace, nor repeat one every few ids.
    for (const lag of [1, 2, 3, 4, 5]) {
      const close = speeds.slice(lag).filter((v, i) => Math.abs(v - speeds[i]) < base * 0.02).length;
      expect(close / (speeds.length - lag)).toBeLessThan(0.2);
    }
  });
});
