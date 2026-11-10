import { describe, expect, it } from "vitest";
import { axialYaw } from "../src/structureLayout";

describe("wall and gate orientation", () => {
  it("keeps the authored (east-west) orientation when the line runs that way", () => {
    expect(axialYaw(false, false, true, true)).toBe(0);
    expect(axialYaw(false, false, true, false)).toBe(0);
  });

  it("turns a quarter for a north-south line", () => {
    expect(axialYaw(true, true, false, false)).toBeCloseTo(Math.PI / 2, 6);
    expect(axialYaw(true, false, false, false)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("leaves a corner and a lone piece as authored", () => {
    // Both axes: either reading is defensible, and the authored one needs no rotation.
    expect(axialYaw(true, true, true, true)).toBe(0);
    expect(axialYaw(false, false, false, false)).toBe(0);
    // Two neighbours on the short axis of a corner still count as a corner.
    expect(axialYaw(true, false, true, false)).toBe(0);
  });
});
