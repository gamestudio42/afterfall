import { describe, expect, it } from "vitest";
import { isSoftwareRenderer, moodAt, resolvePost } from "../src/post";

describe("post chain", () => {
  it("recognises the software rasterisers CI and headless browsers use", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 17.0.6, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU, OpenGL 4.6)")).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });

  it("auto follows the driver, and on and off override it", () => {
    expect(resolvePost("auto", "SwiftShader")).toBe(false);
    expect(resolvePost("auto", "NVIDIA GeForce RTX 4050")).toBe(true);
    expect(resolvePost("on", "SwiftShader")).toBe(true);
    expect(resolvePost("off", "NVIDIA GeForce RTX 4050")).toBe(false);
  });

  it("blooms lamps at night and only highlights by day", () => {
    const night = moodAt(0);
    const day = moodAt(1);
    expect(night.bloomThreshold).toBeLessThan(0.5);
    expect(day.bloomThreshold).toBeGreaterThan(0.85);
    expect(night.bloomStrength).toBeGreaterThan(day.bloomStrength);
    expect(night.vignette).toBeGreaterThan(day.vignette);
  });

  it("leans the night's shadows blue and keeps every channel near neutral", () => {
    const night = moodAt(0);
    expect(night.shadows[2]).toBeGreaterThan(night.shadows[0]);
    for (const t of [0, 0.5, 1]) {
      const m = moodAt(t);
      for (const c of [...m.shadows, ...m.highlights]) {
        expect(c).toBeGreaterThan(0.85);
        expect(c).toBeLessThan(1.2);
      }
    }
  });

  it("moves continuously through dusk and clamps outside 0..1", () => {
    const mid = moodAt(0.5);
    expect(mid.bloomStrength).toBeCloseTo((moodAt(0).bloomStrength + moodAt(1).bloomStrength) / 2, 6);
    expect(moodAt(-3)).toEqual(moodAt(0));
    expect(moodAt(7)).toEqual(moodAt(1));
  });
});
