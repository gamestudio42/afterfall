import { describe, expect, it } from "vitest";
import { portraitFraming } from "../src/GameRenderer";

/**
 * The portrait is rendered by WebGL, which a unit test cannot reach, so what is
 * tested here is the framing it depends on: the numbers are the difference
 * between a portrait and a photo of an arm.
 */
describe("enquadramento do retrato", () => {
  it("olha para a altura da cabeca do modelo, que tem 1,9 m", () => {
    const { eye, target } = portraitFraming();
    expect(target.y).toBeGreaterThan(1.5);
    expect(target.y).toBeLessThan(1.9);
    expect(eye.y).toBeGreaterThan(target.y - 0.5);
  });

  it("fica de tres quartos e perto o suficiente para o rosto ler a 72 px", () => {
    const { eye, target, fov } = portraitFraming();
    const distance = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
    expect(distance).toBeGreaterThan(0.8);
    expect(distance).toBeLessThan(2.5);
    expect(eye.x).toBeGreaterThan(0); // turned, not straight on
    expect(fov).toBeGreaterThan(20);
    expect(fov).toBeLessThan(50);
  });
});
