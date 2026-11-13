import { describe, expect, it } from "vitest";
import { GOVERNOR_DEFAULTS, ResolutionGovernor } from "../src/governor";

/** Feeds `seconds` of frames at a fixed interval; returns every scale change in order. */
function run(g: ResolutionGovernor, ms: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) {
    const s = g.sample(ms);
    if (s !== null) changes.push(s);
  }
  return changes;
}

describe("resolution governor", () => {
  it("holds full resolution at the display's refresh rate", () => {
    const g = new ResolutionGovernor();
    expect(run(g, 16.7, 60)).toEqual([]);
    expect(g.scale).toBe(1);
  });

  it("steps down after sustained slow frames, and keeps going while they stay slow", () => {
    const g = new ResolutionGovernor();
    expect(run(g, 40, 1)).toEqual([]);
    const changes = run(g, 40, 6);
    expect(changes[0]).toBe(0.9);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(g.scale).toBeLessThan(0.9);
  });

  it("never goes below its floor", () => {
    const g = new ResolutionGovernor();
    run(g, 60, 120);
    expect(g.scale).toBe(GOVERNOR_DEFAULTS.min);
  });

  it("ignores a stall and does not count it as time spent slow", () => {
    const g = new ResolutionGovernor();
    for (let i = 0; i < 20; i++) {
      expect(g.sample(2000)).toBeNull();
      run(g, 16.7, 0.5);
    }
    expect(g.scale).toBe(1);
  });

  it("rises again only after a quiet cooldown and a long fast stretch, one small step at a time", () => {
    const g = new ResolutionGovernor();
    run(g, 40, 2);
    const low = g.scale;
    expect(low).toBeLessThan(1);
    // Fast but inside the cooldown: no rise yet.
    expect(run(g, 16.7, 8)).toEqual([]);
    const up = run(g, 16.7, 60);
    expect(up[0]).toBeCloseTo(low + GOVERNOR_DEFAULTS.riseStep, 5);
    expect(g.scale).toBe(1);
  });

  it("does not oscillate when the load sits between the two limits", () => {
    const g = new ResolutionGovernor();
    // 21 ms is neither slow (25) nor fast (18.2): nothing should ever change.
    expect(run(g, 21, 120)).toEqual([]);
  });
});
