import { describe, expect, it } from "vitest";
import { axialYaw, footprintSamples, plinthFrame } from "../src/structureLayout";

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

describe("a structure's plinth", () => {
  it("lies along a slanted wall piece, as long as the piece and a metre deep", () => {
    const f = plinthFrame("wall", 2, { yaw: Math.PI / 4, stretch: Math.SQRT2 });
    expect(f).toEqual({ yaw: Math.PI / 4, length: 2 * Math.SQRT2, depth: 1 });
    // Its ground is read along the diagonal, not over the whole cell.
    const far = Math.max(...footprintSamples(f).map(([x, z]) => Math.hypot(x, z)));
    expect(far).toBeCloseTo(Math.hypot(Math.SQRT2, 0.5));
    // The corner samples lie on the diagonal: east and north together (render yaw turns +x to -z).
    expect(footprintSamples(f).some(([x, z]) => x > 0.6 && z < -0.6 && Math.abs(x + z) < 0.75)).toBe(true);
  });

  it("is a turned farm's or tower's own square, turned with it, and a junction pier's cell", () => {
    expect(plinthFrame("farm", 8, null, 0.5)).toEqual({ yaw: 0.5, length: 8, depth: 8 });
    expect(plinthFrame("tower", 4, null, -0.3)).toEqual({ yaw: -0.3, length: 4, depth: 4 });
    expect(plinthFrame("wall", 2, null, 1)).toEqual({ yaw: 0, length: 2, depth: 2 });
    const turned = footprintSamples(plinthFrame("farm", 8, null, Math.PI / 4));
    // A square turned 45°: its corners reach 4√2 along the axes, not 4 on each.
    expect(Math.max(...turned.map(([x]) => x))).toBeCloseTo(4 * Math.SQRT2);
  });
});
