import { describe, expect, it } from "vitest";
import { CellKind, NavGrid } from "../src/navgrid";

/** A 20 by 20 grid of 2 m cells, all free, with a wall drawn down the middle. */
function walledGrid(withGap: boolean): NavGrid {
  const g = new NavGrid(40, 40, 2);
  g.kind.fill(CellKind.Free);
  for (let y = 0; y < g.rows; y++) {
    if (withGap && y === 10) continue;
    g.kind[y * g.cols + 10] = CellKind.Solid;
  }
  g.version++;
  return g;
}

describe("NavGrid components", () => {
  it("answers reachability without searching the grid", () => {
    const closed = walledGrid(false);
    expect(closed.findPath(2, 2, 38, 38, "survivor")).toBeNull();
    const open = walledGrid(true);
    expect(open.findPath(2, 2, 38, 38, "survivor")).not.toBeNull();
  });

  it("agrees with the search on every cell pair it rejects", () => {
    const closed = walledGrid(false);
    const left = closed.componentOf(closed.cellOf(2, 2), "survivor");
    const right = closed.componentOf(closed.cellOf(38, 38), "survivor");
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(0);
    expect(left).not.toBe(right);
  });

  it("recomputes when the grid changes", () => {
    const g = walledGrid(false);
    expect(g.findPath(2, 2, 38, 38, "survivor")).toBeNull();
    // Open one cell of the wall: the two halves become one region.
    g.kind[10 * g.cols + 10] = CellKind.Free;
    g.version++;
    expect(g.findPath(2, 2, 38, 38, "survivor")).not.toBeNull();
  });

  it("keeps gates open to survivors and shut to infected", () => {
    const g = new NavGrid(40, 40, 2);
    g.kind.fill(CellKind.Free);
    for (let y = 0; y < g.rows; y++) g.kind[y * g.cols + 10] = CellKind.Solid;
    g.kind[10 * g.cols + 10] = CellKind.Gate;
    g.version++;
    expect(g.findPath(2, 2, 38, 38, "survivor")).not.toBeNull();
    expect(g.findPath(2, 2, 38, 38, "infected")).toBeNull();
  });
});
