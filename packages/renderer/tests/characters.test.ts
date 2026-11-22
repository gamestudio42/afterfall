import { describe, expect, it } from "vitest";
import { CharacterMotion, infectedBuild } from "../src/characters";
import { Simulation } from "@afterfall/core";

function subject() {
  const sim = new Simulation({ seed: 4242 });
  const e = sim.spawnSurvivor(10, 10);
  return { sim, e, motion: new CharacterMotion(e, 10, 10, 0) };
}

describe("continuous character animation", () => {
  it("blends adjacent walk keys by distance and settles into a planted stance", () => {
    const { e, motion } = subject();
    motion.update(e, 10.15, 10, 0.05);
    const walking = motion.weights.slice(8, 20);
    expect(walking.filter((weight) => weight > 0)).toHaveLength(2);
    const phase = motion.phase;
    for (let i = 2; i < 30; i++) motion.update(e, 10.15, 10, i * 0.05);
    expect(motion.phase).toBe(phase);
    expect(motion.weights.slice(8, 20).reduce((a, b) => a + b, 0)).toBeLessThan(0.001);
  });

  it("freezes breathing, walking and attack recovery while simulation time is paused", () => {
    const { e, motion } = subject();
    motion.update(e, 10.15, 10, 0.1);
    e.survivor!.cooldown = 1;
    motion.update(e, 10.15, 10, 0.2);
    const weights = [...motion.weights];
    for (let i = 0; i < 120; i++) motion.update(e, 10.15, 10, 0.2);
    expect(motion.weights).toEqual(weights);
  });

  it("does not turn teleports into a burst of walking", () => {
    const { e, motion } = subject();
    const phase = motion.phase;
    motion.update(e, 110, 50, 0.1);
    expect(motion.phase).toBe(phase);
    expect(motion.weights.slice(8, 20).every((weight) => weight === 0)).toBe(true);
  });

  it("keeps a stride independent of frame rate and playback speed", () => {
    const a = subject();
    const b = subject();
    for (let i = 1; i <= 60; i++) a.motion.update(a.e, 10 + i / 60, 10, i / 60);
    for (let i = 1; i <= 15; i++) b.motion.update(b.e, 10 + i / 15, 10, i / 15);
    expect(a.motion.phase).toBeCloseTo(b.motion.phase, 8);
  });

  it("reacts to an actual attack and damage without overdriving the morph mesh", () => {
    const { e, motion } = subject();
    motion.update(e, 10.1, 10, 0.1);
    expect(motion.weights[22]).toBe(0);
    e.survivor!.cooldown = 1;
    e.health!.hp -= 5;
    motion.update(e, 10.2, 10, 0.2);
    expect(motion.weights[22]).toBeGreaterThan(0);
    motion.update(e, 10.3, 10, 0.35);
    expect(motion.weights[23]).toBeGreaterThan(0);
    expect(motion.weights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.00001);
    motion.update(e, 10.3, 10, 1.5);
    expect(motion.weights[22]).toBe(0);
    expect(motion.weights[23]).toBe(0);
  });

  it("shows the final shot, then switches an empty firearm to melee", () => {
    const { e } = subject();
    e.survivor!.weapon = "pistol";
    e.survivor!.ammo = 1;
    const motion = new CharacterMotion(e, 10, 10, 0);
    e.survivor!.ammo = 0;
    e.survivor!.cooldown = 0.8;
    motion.update(e, 10, 10, 0.1);
    expect(motion.firing).toBe(true);
    expect(motion.weights[24]).toBeGreaterThan(0);
    e.survivor!.cooldown = 0;
    motion.update(e, 10, 10, 1);
    e.survivor!.cooldown = 0.8;
    motion.update(e, 10, 10, 1.2);
    expect(motion.firing).toBe(false);
    expect(motion.weights[22]).toBeGreaterThan(0);
    expect(motion.weights[24]).toBe(0);
  });

  it("flinches into its own pose when hurt, and recovers", () => {
    const { e, motion } = subject();
    motion.update(e, 10, 10, 0.1);
    expect(motion.weights[25]).toBe(0);
    e.health!.hp -= 5;
    motion.update(e, 10, 10, 0.2);
    expect(motion.weights[25]).toBeGreaterThan(0.4);
    expect(motion.weights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.00001);
    motion.update(e, 10, 10, 0.6);
    expect(motion.weights[25]).toBe(0);
  });

  it("stands alive: it breathes, and now and then shifts its weight", () => {
    const { e, motion } = subject();
    let breath = 0;
    let shift = 0;
    for (let i = 1; i <= 400; i++) {
      motion.update(e, 10, 10, i * 0.05);
      breath = Math.max(breath, motion.weights[20]);
      shift = Math.max(shift, motion.weights[21]);
      expect(motion.weights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.00001);
    }
    expect(breath).toBeGreaterThan(0.5);
    expect(shift).toBeGreaterThan(0.5);
  });

  it("covers a jog's ground per cycle: 2.5 m for two steps, not a scurry", () => {
    const { e, motion } = subject();
    const start = motion.phase;
    for (let i = 1; i <= 100; i++) motion.update(e, 10 + i * 0.0125, 10, i * 0.004);
    // 1.25 m is half a cycle.
    expect((motion.phase - start + 1) % 1).toBeCloseTo(0.5, 5);
  });

  it("walks at a chore's pace, 1.2 m a cycle, on the walk keys", () => {
    const { e, motion } = subject();
    const start = motion.phase;
    // 1.7 m/s for 0.6 m: half a walking cycle.
    for (let i = 1; i <= 60; i++) motion.update(e, 10 + i * 0.01, 10, i * (0.01 / 1.7));
    expect((motion.phase - start + 1) % 1).toBeCloseTo(0.5, 2);
    const walk = motion.weights.slice(0, 8).reduce((a, b) => a + b, 0);
    const run = motion.weights.slice(8, 20).reduce((a, b) => a + b, 0);
    expect(walk).toBeGreaterThan(0.9);
    expect(run).toBe(0);
  });

  it("breaks into a jog through a cross-fade, not a jump", () => {
    const { e, motion } = subject();
    let x = 10;
    let time = 0;
    const step = (speed: number, n: number) => {
      for (let i = 0; i < n; i++) {
        x += speed * 0.016;
        time += 0.016;
        motion.update(e, x, 10, time);
      }
    };
    step(1.7, 60);
    step(3.0, 6);
    const walk = motion.weights.slice(0, 8).reduce((a, b) => a + b, 0);
    const run = motion.weights.slice(8, 20).reduce((a, b) => a + b, 0);
    expect(walk).toBeGreaterThan(0.05);
    expect(run).toBeGreaterThan(0.05);
    step(3.0, 120);
    expect(motion.weights.slice(0, 8).reduce((a, b) => a + b, 0)).toBeLessThan(0.01);
  });

  it("turns across the angle wrap by the short route", () => {
    const { e } = subject();
    e.transform!.heading = Math.PI - 0.01;
    const motion = new CharacterMotion(e, 10, 10, 0);
    e.transform!.heading = -Math.PI + 0.01;
    motion.update(e, 10, 10, 0.05);
    expect(Math.abs(motion.heading - Math.PI)).toBeLessThan(0.011);
  });
});

describe("infected builds", () => {
  it("are fixed per body and vary across a horde", () => {
    const builds = Array.from({ length: 400 }, (_, id) => infectedBuild(id));
    expect(infectedBuild(17)).toEqual(builds[17]);
    const mirrored = builds.filter((b) => b.mirror).length;
    expect(mirrored).toBeGreaterThan(160);
    expect(mirrored).toBeLessThan(240);
    for (const b of builds) {
      expect(b.height).toBeGreaterThanOrEqual(0.92);
      expect(b.height).toBeLessThanOrEqual(1.08);
      // Small enough that the feet stay on their spot as the body pivots on them.
      expect(Math.abs(b.lean) + Math.abs(b.list) + b.rock).toBeLessThanOrEqual((14.5 * Math.PI) / 180);
    }
    const heights = builds.map((b) => b.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.12);
  });

  it("go to the infected only", () => {
    const sim = new Simulation({ seed: 9 });
    const z = sim.spawnInfected("walker", 5, 5, -1);
    const s = sim.spawnSurvivor(10, 10);
    expect(new CharacterMotion(z, 5, 5, 0).build).toEqual(infectedBuild(z.id));
    expect(new CharacterMotion(s, 10, 10, 0).build).toBeNull();
  });
});

describe("turns and shoves", () => {
  it("leans into a turn, the way it turns, and stands straight again", () => {
    const { e, motion } = subject();
    const r = 4;
    // A jog round a circle anticlockwise, the heading following the path.
    for (let i = 1; i <= 60; i++) {
      const a = i * 0.04;
      e.transform!.heading = a;
      motion.update(e, 10 + r * Math.sin(a), 10 - r * Math.cos(a), i * 0.05);
    }
    expect(motion.bank).toBeGreaterThan(0.05);
    expect(motion.bank).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-9);
    // Clockwise, the other way.
    const b = subject();
    for (let i = 1; i <= 60; i++) {
      const a = -i * 0.04;
      b.e.transform!.heading = a;
      b.motion.update(b.e, 10 + r * Math.sin(-a), 10 + r * Math.cos(a) - r, i * 0.05);
    }
    expect(b.motion.bank).toBeLessThan(-0.05);
    // Straight on, upright.
    const x = 10 + r * Math.sin(2.4);
    for (let i = 61; i <= 120; i++) motion.update(e, x + (i - 60) * 0.15, 10 - r * Math.cos(2.4), i * 0.05);
    e.transform!.heading = 0;
    for (let i = 121; i <= 160; i++) motion.update(e, x + (i - 60) * 0.15, 10 - r * Math.cos(2.4), i * 0.05);
    expect(Math.abs(motion.bank)).toBeLessThan(0.01);
  });

  it("plays a shove to the side as a shift of weight, not a stride", () => {
    const { e, motion } = subject();
    e.transform!.heading = 0;
    // Pushed along y while facing x: a crowd making room.
    for (let i = 1; i <= 20; i++) motion.update(e, 10, 10 + i * 0.03, i * 0.05);
    // Walk and run keys are 0 to 19, then breath and shift.
    const stride = motion.weights.slice(0, 20).reduce((a, b) => a + b, 0);
    expect(motion.weights[21]).toBeGreaterThan(stride);
  });
});
