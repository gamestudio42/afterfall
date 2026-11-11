import { describe, expect, it } from "vitest";
import { selectionLines } from "../src/outline";

/** A closed ring of `n` points on a circle, the shape of a curved OSM footprint. */
function circle(n: number, r = 60): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: r + Math.cos(a) * r, y: r + Math.sin(a) * r };
  });
}

/** Verticals in the line list: pairs that share x and z and differ only in y. */
function uprights(v: number[]): number {
  let n = 0;
  for (let i = 0; i < v.length; i += 6) {
    if (Math.abs(v[i] - v[i + 3]) < 1e-6 && Math.abs(v[i + 2] - v[i + 5]) < 1e-6) n++;
  }
  return n;
}

describe("selection outline", () => {
  it("keeps a four-sided block as it was: one upright per corner", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(uprights(selectionLines(square, 30))).toBe(4);
  });

  it("caps the uprights on a curved footprint", () => {
    // The Eiffel Tower's footprint has dozens of points; one upright each drew a forest of
    // three-hundred-metre lines when the tower was selected.
    const n = uprights(selectionLines(circle(80), 330));
    expect(n).toBeLessThanOrEqual(16);
    // A footprint with many points is a shape, not a box: four uprights at its extremes.
    expect(n).toBe(4);
    // And not zero either: a smooth ring has no corners, and two rings with nothing
    // between them read as two outlines.
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("still draws both rings for the whole footprint", () => {
    const v = selectionLines(circle(80), 330);
    // 80 edges, each with a bottom pair and a top pair, plus the uprights.
    expect(v.length / 6).toBe(80 * 2 + uprights(v));
  });
});
