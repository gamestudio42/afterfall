import { describe, expect, it } from "vitest";
import { CharacterMotion } from "../src/characters";
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
    const walking = motion.weights.slice(12, 16);
    expect(walking.filter((weight) => weight > 0)).toHaveLength(2);
    const phase = motion.phase;
    for (let i = 2; i < 30; i++) motion.update(e, 10.15, 10, i * 0.05);
    expect(motion.phase).toBe(phase);
    expect(motion.weights.slice(12, 16).reduce((a, b) => a + b, 0)).toBeLessThan(0.001);
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
    expect(motion.weights.slice(12, 16).every((weight) => weight === 0)).toBe(true);
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
    expect(motion.weights[9]).toBe(0);
    e.survivor!.cooldown = 1;
    e.health!.hp -= 5;
    motion.update(e, 10.2, 10, 0.2);
    expect(motion.weights[9]).toBeGreaterThan(0);
    motion.update(e, 10.3, 10, 0.35);
    expect(motion.weights[10]).toBeGreaterThan(0);
    expect(motion.weights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.00001);
    motion.update(e, 10.3, 10, 1.5);
    expect(motion.weights[9]).toBe(0);
    expect(motion.weights[10]).toBe(0);
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
    expect(motion.weights[11]).toBeGreaterThan(0);
    e.survivor!.cooldown = 0;
    motion.update(e, 10, 10, 1);
    e.survivor!.cooldown = 0.8;
    motion.update(e, 10, 10, 1.2);
    expect(motion.firing).toBe(false);
    expect(motion.weights[9]).toBeGreaterThan(0);
    expect(motion.weights[11]).toBe(0);
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
