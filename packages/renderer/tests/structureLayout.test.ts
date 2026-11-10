import { describe, expect, it } from "vitest";
import { axialYaw, cornerBlockScale } from "../src/structureLayout";

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

describe("junction block", () => {
  it("scales the slab so it fills a cell, not to the cell size", () => {
    // The slab is 0.5 m thick; a 2 m cell needs 4x. Passing the cell size itself (2) left
    // half a metre of notch on each side, which was the bug this test exists for.
    expect(cornerBlockScale(2)).toBeCloseTo(4, 6);
    expect(0.5 * cornerBlockScale(2)).toBeCloseTo(2, 6);
  });
});
