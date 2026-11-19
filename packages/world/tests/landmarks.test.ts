import { describe, expect, it } from "vitest";
import { latticeFrame } from "../src";

describe("lattice frame", () => {
  it("finds the square through the tips of four legs turned 45 degrees", () => {
    // An X of four arms, like the Eiffel Tower's outline: legs at the tips, arches between.
    const arm = 60;
    const poly = [
      { x: 0, y: -arm },
      { x: 12, y: -12 },
      { x: arm, y: 0 },
      { x: 12, y: 12 },
      { x: 0, y: arm },
      { x: -12, y: 12 },
      { x: -arm, y: 0 },
      { x: -12, y: -12 },
    ];
    const f = latticeFrame(poly);
    expect(f.centre.x).toBeCloseTo(0, 6);
    expect(f.centre.y).toBeCloseTo(0, 6);
    // The square through the tips has a half side of arm / sqrt 2.
    expect(f.a).toBeCloseTo(arm / Math.SQRT2, 4);
    expect(f.b).toBeCloseTo(arm / Math.SQRT2, 4);
    expect(Math.abs(f.u.x)).toBeCloseTo(Math.SQRT1_2, 4);
  });
});
