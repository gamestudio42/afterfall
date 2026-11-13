import { describe, expect, it } from "vitest";
import { lineCells, lineFrame } from "../src/line";

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

describe("a wall line's frame", () => {
  it("leaves lines along an axis to the grid", () => {
    expect(lineFrame([0, 0], [6, 0], [3, 0])).toBeNull();
    expect(lineFrame([2, 9], [2, 1], [2, 4])).toBeNull();
  });

  it("gives every piece of a line off the axes the same angle", () => {
    // A real street at ~27°: the grid staircase mixes straight and diagonal steps, and
    // orienting each piece from its neighbours turned them 0° and 45° in turn.
    const cells = lineCells([0, 0], [10, -5]);
    const frames = cells.map((c) => lineFrame([0, 0], [10, -5], c)!);
    for (const f of frames) {
      expect(f.yaw).toBeCloseTo(Math.atan2(5, 10));
      expect(f.stretch).toBeCloseTo(Math.hypot(10, 5) / 10);
    }
  });

  it("puts every piece on the drawn line, end to end", () => {
    const from: [number, number] = [3, 2];
    const to: [number, number] = [8, 14];
    const cells = lineCells(from, to);
    const points = cells.map((c) => {
      const f = lineFrame(from, to, c)!;
      expect(Math.abs(f.ox) + Math.abs(f.oy)).toBeLessThanOrEqual(0.5);
      return [c[0] + f.ox, c[1] + f.oy];
    });
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    for (let i = 0; i < points.length; i++) {
      // On the line: no distance across it.
      const cross = (points[i][0] - from[0]) * (to[1] - from[1]) - (points[i][1] - from[1]) * (to[0] - from[0]);
      expect(cross / len).toBeCloseTo(0);
      // Consecutive pieces sit exactly one stretched panel apart, so they meet.
      if (i > 0) {
        const gap = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        expect(gap).toBeCloseTo(lineFrame(from, to, cells[i])!.stretch);
      }
    }
  });
});
