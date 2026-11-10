import { describe, expect, it } from "vitest";
import { SpatialHash } from "../src/spatial";

describe("SpatialHash", () => {
  it("finds what is inside the radius and nothing outside it", () => {
    const h = new SpatialHash(8);
    h.insert(1, 10, 10);
    h.insert(2, 60, 60);
    const seen: number[] = [];
    h.query(10, 10, 4, (id) => seen.push(id));
    expect(seen).toContain(1);
    expect(seen).not.toContain(2);
  });

  it("forgets everything on clear", () => {
    const h = new SpatialHash(8);
    h.insert(1, 10, 10);
    h.clear();
    const seen: number[] = [];
    h.query(10, 10, 4, (id) => seen.push(id));
    expect(seen).toHaveLength(0);
  });

  it("does not grow a bucket per tick", () => {
    const h = new SpatialHash(8);
    // Walk one agent across the map for a thousand ticks, as a long game would.
    for (let t = 0; t < 1000; t++) {
      h.clear();
      h.insert(1, t, t);
      h.insert(2, t + 4, t + 4);
    }
    expect(h.liveBuckets).toBeLessThanOrEqual(2);
  });

  it("keeps two ids that share a cell", () => {
    const h = new SpatialHash(8);
    h.insert(7, 1, 1);
    h.insert(8, 2, 2);
    const seen: number[] = [];
    h.query(1, 1, 2, (id) => seen.push(id));
    expect(seen.sort()).toEqual([7, 8]);
  });
});
