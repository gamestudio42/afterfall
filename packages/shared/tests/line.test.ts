import { describe, expect, it } from "vitest";
import { lineCells } from "../src/line";

describe("a wall line", () => {
  it("includes both ends and one cell per step along an axis", () => {
    expect(lineCells([4, 7], [8, 7])).toEqual([
      [4, 7],
      [5, 7],
      [6, 7],
      [7, 7],
      [8, 7],
    ]);
    expect(lineCells([8, 9], [8, 6])).toEqual([
      [8, 9],
      [8, 8],
      [8, 7],
      [8, 6],
    ]);
  });

  it("draws diagonals, which the axis lock could not", () => {
    // The line used to snap to the dominant axis: a drag at forty-five degrees built a
    // wall that ran ninety degrees away from the mouse.
    const cells = lineCells([0, 0], [4, 4]);
    expect(cells).toHaveLength(5);
    expect(cells[2]).toEqual([2, 2]);
  });

  it("keeps every step adjacent, so the wall has no holes", () => {
    for (const to of [
      [10, 3],
      [3, 10],
      [-7, 5],
      [5, -7],
    ] as [number, number][]) {
      const cells = lineCells([0, 0], to);
      for (let i = 1; i < cells.length; i++) {
        const dx = Math.abs(cells[i][0] - cells[i - 1][0]);
        const dy = Math.abs(cells[i][1] - cells[i - 1][1]);
        expect(Math.max(dx, dy)).toBe(1);
      }
      expect(cells[cells.length - 1]).toEqual(to);
    }
  });

  it("is the same line drawn from either end", () => {
    const a = lineCells([2, 5], [11, 1]);
    const b = lineCells([11, 1], [2, 5]);
    expect(a.length).toBe(b.length);
    expect(new Set(a.map(([x, y]) => `${x},${y}`))).toEqual(new Set(b.map(([x, y]) => `${x},${y}`)));
  });
});
