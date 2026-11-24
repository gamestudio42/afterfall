import { describe, expect, it } from "vitest";
import { distToPolyline } from "@afterfall/shared";
import { CITY_SIZES, CellKind, NavGrid, generateVariedCity, heightAt, isWalkableKind, type CityMap, type CitySize } from "../src";

/** Cells reachable on foot from a point. */
function flood(g: NavGrid, x: number, y: number): Uint8Array {
  const seen = new Uint8Array(g.cols * g.rows);
  const start = g.cellOf(x, y);
  const queue = [start];
  seen[start] = 1;
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const cx = c % g.cols;
    const cy = (c - cx) / g.cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!g.inBounds(cx + dx, cy + dy)) continue;
      const n = g.index(cx + dx, cy + dy);
      if (seen[n] || !isWalkableKind(g.kind[n])) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const maps = new Map<number, CityMap>(SEEDS.map((s) => [s, generateVariedCity(s)]));

describe("the varied generated city", () => {
  it("is the same map for the same seed", () => {
    expect(JSON.stringify(generateVariedCity(7))).toBe(JSON.stringify(maps.get(7)));
  });

  it("is not the same shape from seed to seed", () => {
    const sites = new Set([...maps.values()].map((m) => m.generated!.site));
    expect([...sites].sort()).toEqual(["escarpment", "hills", "rolling", "valley"]);
    const sizes = new Set([...maps.values()].map((m) => `${m.width}x${m.height}`));
    expect(sizes.size).toBeGreaterThan(24);
    // Relief everywhere, and more than a few metres of it.
    for (const m of maps.values()) {
      const t = m.terrain!;
      expect(Math.max(...t.heights) / 10).toBeGreaterThan(m.generated!.site === "rolling" ? 4 : 8);
    }
  });

  it("is playable on every seed: every door reached from every horde entry", () => {
    for (const [seed, m] of maps) {
      const g = NavGrid.fromCity(m);
      expect(m.buildings.length, `seed ${seed}`).toBeGreaterThanOrEqual(40);
      for (const type of ["hospital", "police", "school", "supermarket"])
        expect(
          m.buildings.some((b) => b.type === type),
          `seed ${seed} ${type}`,
        ).toBe(true);
      expect(m.spawnPoints.length).toBeGreaterThanOrEqual(4);
      const reach = flood(g, m.spawnPoints[0].x, m.spawnPoints[0].y);
      for (const p of m.spawnPoints) expect(reach[g.cellOf(p.x, p.y)], `seed ${seed} entry`).toBe(1);
      for (const b of m.buildings) expect(reach[g.cellOf(b.entrance.x, b.entrance.y)], `seed ${seed} ${b.id}`).toBe(1);
      m.buildings.forEach((b, i) => expect(b.index).toBe(i));
    }
  });

  it("comes in four sizes, up to 800 m across, never larger than asked for", () => {
    for (const size of Object.keys(CITY_SIZES) as CitySize[]) {
      const side = CITY_SIZES[size];
      for (let seed = 1; seed <= 6; seed++) {
        const m = generateVariedCity(seed, { size });
        expect(m.width, `${size} seed ${seed}`).toBeLessThanOrEqual(side);
        expect(m.width).toBeGreaterThan(side * 0.85);
        expect(m.height).toBeGreaterThan(side * 0.65);
        const g = NavGrid.fromCity(m);
        const reach = flood(g, m.spawnPoints[0].x, m.spawnPoints[0].y);
        for (const b of m.buildings) expect(reach[g.cellOf(b.entrance.x, b.entrance.y)], `${size} seed ${seed} ${b.id}`).toBe(1);
      }
    }
    // More city, not the same city stretched: the huge one has several times the buildings.
    expect(generateVariedCity(5, { size: "huge" }).buildings.length).toBeGreaterThan(generateVariedCity(5).buildings.length * 2.5);
  });

  it("lays its streets square to the map, turned, or turned and bent", () => {
    const shapes = new Set([...maps.values()].map((m) => m.generated!.shape));
    expect([...shapes].sort()).toEqual(["bent", "square", "turned"]);
    for (const m of maps.values()) {
      // How many streets run along neither axis: none on a square plan, most on the others.
      const slanted = m.roads.filter((r) => {
        const p = r.path!;
        const dx = p[p.length - 1].x - p[0].x;
        const dy = p[p.length - 1].y - p[0].y;
        return Math.abs(dx) > 2 && Math.abs(dy) > 2;
      }).length;
      if (m.generated!.shape === "square") expect(slanted, `seed ${m.seed}`).toBe(0);
      else expect(slanted / m.roads.length, `seed ${m.seed}`).toBeGreaterThan(0.5);
      // Turned, a building is the outline of its lot, turned with the street.
      if (m.generated!.shape !== "square") expect(m.buildings.every((b) => (b.footprint?.length ?? 0) >= 4)).toBe(true);
    }
  });

  it("never draws a street up a cliff: a street climbs an escarpment by a ramp", () => {
    for (const size of ["medium", "large", "huge"] as CitySize[])
      for (let seed = 1; seed <= 16; seed++) {
        const m = generateVariedCity(seed, { size });
        const limit = m.generated!.site === "escarpment" ? 0.35 : 0.5;
        expect(steepestStreet(m), `${size} seed ${seed} ${m.generated!.site}`).toBeLessThan(limit);
      }
  });

  it("puts a river in a valley that only its bridges cross", () => {
    const valleys = [...maps.values()].filter((m) => m.generated!.site === "valley");
    expect(valleys.length).toBeGreaterThan(3);
    for (const m of valleys) {
      expect(m.waters?.length).toBe(1);
      expect(m.bridges?.length).toBeGreaterThanOrEqual(1);
      const g = NavGrid.fromCity(m);
      let water = 0;
      for (const k of g.kind) if (k === CellKind.Water) water++;
      expect(water).toBeGreaterThan(500);
      // The two banks are joined, and only by the streets over the bridges: without them
      // the river cuts the city in two.
      const west = m.spawnPoints.reduce((a, b) => (b.x < a.x ? b : a));
      const east = m.spawnPoints.reduce((a, b) => (b.x > a.x ? b : a));
      expect(flood(g, west.x, west.y)[g.cellOf(east.x, east.y)]).toBe(1);
      const river = m.waters![0];
      const overWater = (r: CityMap["roads"][number]) =>
        r.path!.some((p, k) => k > 0 && crosses(r.path![k - 1], p, river.path!, river.width! / 2));
      expect(m.roads.filter(overWater).length).toBe(m.bridges!.length);
      const cut = NavGrid.fromCity({ ...m, roads: m.roads.filter((r) => !overWater(r)), bridges: [] });
      expect(flood(cut, west.x, west.y)[cut.cellOf(east.x, east.y)]).toBe(0);
    }
  });

  it("breaks an escarpment into a cliff that the streets climb", () => {
    const scarps = [...maps.values()].filter((m) => m.generated!.site === "escarpment");
    expect(scarps.length).toBeGreaterThan(2);
    for (const m of scarps) {
      const g = NavGrid.fromCity(m);
      let cliff = 0;
      for (const k of g.kind) if (k === CellKind.Cliff) cliff++;
      expect(cliff, `seed ${m.seed}`).toBeGreaterThan(40);
      // Nothing is built on the face.
      for (const b of m.buildings) expect(g.kind[g.cellOf(b.entrance.x, b.entrance.y)]).toBe(CellKind.Free);
    }
  });

  it("keeps the valley floor above the water, so the river does not show through it", () => {
    for (const m of [...maps.values()].filter((x) => x.generated!.site === "valley")) {
      const t = m.terrain!;
      const river = m.waters![0];
      const level = Math.min(...river.path!.map((p) => heightAtNode(t, p.x, p.y)));
      for (const b of m.buildings) expect(heightAtNode(t, b.entrance.x, b.entrance.y)).toBeGreaterThan(level + 1);
    }
  });
});

/** The steepest grade along any street, sampled every 2 m. */
function steepestStreet(m: CityMap): number {
  let worst = 0;
  for (const r of m.roads) {
    const p = r.path!;
    for (let i = 1; i < p.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) / 2));
      let prev = p[i - 1];
      for (let s = 1; s <= n; s++) {
        const q = { x: p[i - 1].x + ((p[i].x - p[i - 1].x) * s) / n, y: p[i - 1].y + ((p[i].y - p[i - 1].y) * s) / n };
        const d = Math.hypot(q.x - prev.x, q.y - prev.y) || 1;
        worst = Math.max(worst, Math.abs(heightAt(m.terrain, q.x, q.y) - heightAt(m.terrain, prev.x, prev.y)) / d);
        prev = q;
      }
    }
  }
  return worst;
}

/** Whether a segment comes within `reach` of a polyline. */
function crosses(a: { x: number; y: number }, b: { x: number; y: number }, line: { x: number; y: number }[], reach: number): boolean {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (distToPolyline(x, y, line) < reach) return true;
  }
  return false;
}

function heightAtNode(t: NonNullable<CityMap["terrain"]>, x: number, y: number): number {
  const c = Math.max(0, Math.min(t.cols - 1, Math.round(x / t.cell)));
  const r = Math.max(0, Math.min(t.rows - 1, Math.round(y / t.cell)));
  return (t.heights[r * t.cols + c] / 10) * t.scale;
}
