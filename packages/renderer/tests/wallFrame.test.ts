import { describe, expect, it } from "vitest";
import { wallFrame } from "../src/structureLayout";

const none = { n: false, s: false, e: false, w: false, ne: false, se: false, sw: false, nw: false };

describe("wall piece frame", () => {
  it("keeps an east-west run flat and a north-south run turned", () => {
    expect(wallFrame(false, false, true, true, false, false, false, false)).toEqual({ yaw: 0, stretch: 1 });
    expect(wallFrame(true, true, false, false, false, false, false, false)).toEqual({
      yaw: Math.PI / 2,
      stretch: 1,
    });
  });

  it("turns to a diagonal run and stretches to the distance between cell centres", () => {
    // The panel is 2 m long and diagonal neighbours are 2.83 m apart: without the stretch
    // a diagonal wall is a row of dashes.
    const ne = wallFrame(none.n, none.s, none.e, none.w, true, false, true, false);
    expect(ne.yaw).toBeCloseTo(Math.PI / 4);
    expect(ne.stretch).toBeCloseTo(Math.SQRT2);
    const se = wallFrame(false, false, false, false, false, true, false, true);
    expect(se.yaw).toBeCloseTo(-Math.PI / 4);
    expect(se.stretch).toBeCloseTo(Math.SQRT2);
  });

  it("turns at the end of a diagonal, where only one neighbour exists", () => {
    expect(wallFrame(false, false, false, false, true, false, false, false).yaw).toBeCloseTo(Math.PI / 4);
    expect(wallFrame(false, false, false, false, false, false, false, true).yaw).toBeCloseTo(-Math.PI / 4);
  });

  it("leaves a lone piece as it was authored", () => {
    expect(wallFrame(none.n, none.s, none.e, none.w, false, false, false, false)).toEqual({ yaw: 0, stretch: 1 });
  });

  it("prefers the orthogonal run at a corner", () => {
    // A cell with both an east and a north-east neighbour is a corner, not a diagonal.
    const f = wallFrame(false, false, true, false, true, false, false, false);
    expect(f.stretch).toBe(1);
    expect(f.yaw).toBe(0);
  });
});
