import { describe, expect, it } from "vitest";
import { distToPolyline, pointInPolygon } from "@afterfall/shared";
import { CellKind, NavGrid, cityFromOverpass, joinRings, overpassTerrainQuery, type CityMap } from "../src";
import { FIXTURE_CENTER, syntheticOverpass, syntheticTerrain } from "./fixtures/osm";

const opts = { ...FIXTURE_CENTER, size: 480, label: "Test" };
const plain = cityFromOverpass(syntheticOverpass(), opts);
const wet = cityFromOverpass({ elements: [...syntheticOverpass().elements, ...syntheticTerrain()] }, opts);
const grid = NavGrid.fromCity(wet);

/** Whether a cell is under a street, which a bridge or a crossing keeps open. */
function onRoad(city: CityMap, x: number, y: number): boolean {
  return city.roads.some((r) => (r.path ? distToPolyline(x, y, r.path) <= (r.width ?? 8) / 2 + 0.5 : false));
}

const centre = (i: number) => grid.centerOf(i);

describe("joining the pieces of an outline", () => {
  const sq = (a: [number, number], b: [number, number]) => [
    { x: a[0], y: a[1] },
    { x: b[0], y: b[1] },
  ];

  it("closes a ring from pieces in any order and direction", () => {
    const rings = joinRings([sq([0, 0], [10, 0]), sq([10, 10], [10, 0]), sq([10, 10], [0, 10]), sq([0, 0], [0, 10])]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it("drops a chain that never closes, rather than guessing at the rest", () => {
    expect(joinRings([sq([0, 0], [10, 0]), sq([10, 0], [10, 10])])).toEqual([]);
  });

  it("keeps two separate rings apart", () => {
    const ring = (x: number) => [
      { x, y: 0 },
      { x: x + 5, y: 0 },
      { x: x + 5, y: 5 },
      { x, y: 5 },
      { x, y: 0 },
    ];
    expect(joinRings([ring(0), ring(20)])).toHaveLength(2);
  });
});

describe("the second Overpass request", () => {
  it("asks for water and railways and not for buildings", () => {
    const q = overpassTerrainQuery(FIXTURE_CENTER.lat, FIXTURE_CENTER.lon, 480);
    expect(q).toContain('"natural"="water"');
    expect(q).toContain("railway");
    expect(q).not.toContain('"building"');
  });
});

describe("water and railways on an imported map", () => {
  it("reads the river, the island, the pond and the canal, clipped to the play area", () => {
    const waters = wet.waters!;
    const river = waters.find((w) => w.id.startsWith("w9001"))!;
    expect(river.polygon!.length).toBeGreaterThanOrEqual(4);
    expect(river.holes).toHaveLength(1);
    for (const w of waters) for (const p of w.polygon ?? w.path!) expect(p.x >= 0 && p.y >= 0 && p.x <= 480 && p.y <= 480).toBe(true);
    expect(waters.some((w) => w.id === "w9002")).toBe(true);
    expect(waters.filter((w) => w.id.startsWith("ww9003"))).toHaveLength(1);
    // A culvert is not open water.
    expect(waters.some((w) => w.id.startsWith("ww9004"))).toBe(false);
  });

  it("reads the railway, but not the tunnel or the tram", () => {
    const ids = wet.rails!.map((r) => r.id);
    expect(ids.some((id) => id.startsWith("rail9005"))).toBe(true);
    expect(ids.some((id) => id.startsWith("rail9006"))).toBe(false);
    expect(ids.some((id) => id.startsWith("rail9007"))).toBe(false);
  });

  it("leaves a map without any as it was", () => {
    expect(plain.waters).toBeUndefined();
    expect(plain.rails).toBeUndefined();
  });

  /** Every free cell of a water area is water; a street or a track across it is not. */
  function checkArea(polygon: { x: number; y: number }[], holes: { x: number; y: number }[][] = []) {
    let water = 0;
    let crossing = 0;
    for (let i = 0; i < grid.kind.length; i++) {
      const { x, y } = centre(i);
      if (!pointInPolygon(x, y, polygon)) continue;
      if (holes.some((h) => pointInPolygon(x, y, h))) {
        expect(grid.kind[i]).not.toBe(CellKind.Water);
        continue;
      }
      if (grid.kind[i] === CellKind.Building) continue;
      if (onRoad(wet, x, y)) {
        // A bridge: the street goes on.
        expect(grid.kind[i]).not.toBe(CellKind.Water);
        crossing++;
        continue;
      }
      // What is not water here is a railway bridge's deck.
      expect([CellKind.Water, CellKind.Rail]).toContain(grid.kind[i]);
      if (grid.kind[i] === CellKind.Water) water++;
    }
    return { water, crossing };
  }

  it("blocks every free cell inside the river, and leaves a street across it open", () => {
    const river = wet.waters!.find((w) => w.id.startsWith("w9001"))!;
    const { water, crossing } = checkArea(river.polygon!, river.holes);
    expect(water).toBeGreaterThan(200);
    expect(crossing).toBeGreaterThan(10);
  });

  it("blocks the pond and the canal", () => {
    const pond = wet.waters!.find((w) => w.id === "w9002")!;
    expect(checkArea(pond.polygon!).water).toBeGreaterThan(0);
    const canal = wet.waters!.find((w) => w.id.startsWith("ww9003"))!;
    // A cell on the centre line, away from streets and buildings, is water.
    let wetOnLine = 0;
    for (let i = 0; i < grid.kind.length; i++) {
      const { x, y } = centre(i);
      if (distToPolyline(x, y, canal.path!) > 3 || onRoad(wet, x, y)) continue;
      if (grid.kind[i] === CellKind.Building) continue;
      expect(grid.kind[i]).toBe(CellKind.Water);
      wetOnLine++;
    }
    expect(wetOnLine).toBeGreaterThan(0);
  });

  it("keeps the island dry", () => {
    const river = wet.waters!.find((w) => w.id.startsWith("w9001"))!;
    const island = river.holes![0];
    let dry = 0;
    for (let i = 0; i < grid.kind.length; i++) {
      const { x, y } = centre(i);
      if (!pointInPolygon(x, y, island)) continue;
      expect(grid.kind[i]).not.toBe(CellKind.Water);
      dry++;
    }
    expect(dry).toBeGreaterThan(0);
  });

  it("does not drown a culvert", () => {
    const at = grid.kind[grid.cellOf(240 + 0, 240 - 120)];
    expect(at).not.toBe(CellKind.Water);
  });

  it("nobody crosses water; a track is walkable", () => {
    const wetCell = [...grid.kind].findIndex((k) => k === CellKind.Water);
    const railCell = [...grid.kind].findIndex((k) => k === CellKind.Rail);
    expect(wetCell).toBeGreaterThanOrEqual(0);
    expect(railCell).toBeGreaterThanOrEqual(0);
    for (const agent of ["survivor", "infected"] as const) {
      expect(grid.passableIndex(wetCell, agent)).toBe(false);
      expect(grid.passableIndex(railCell, agent)).toBe(true);
    }
  });

  it("a railway on a bridge over the river keeps its deck", () => {
    // The track crosses the river between x = 100 and x = 300 at y = 20..30 and 70.
    const cells = [...grid.kind].map((k, i) => ({ k, i })).filter(({ k }) => k === CellKind.Rail);
    const nearRiver = cells.filter(({ i }) => {
      const { y } = centre(i);
      return y > 240 + 20 && y < 240 + 75;
    });
    expect(nearRiver.length).toBeGreaterThan(0);
  });

  it("loses only the buildings that stand out in the water, and every door is on dry land", () => {
    const kept = new Set(wet.buildings.map((b) => b.id));
    const lost = plain.buildings.filter((b) => !kept.has(b.id));
    // The fixture drops one building into the river; a bridge keeps every bank connected.
    expect(lost.length).toBeLessThanOrEqual(2);
    for (const b of lost) {
      const c = { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
      expect(wet.waters!.some((w) => w.polygon && pointInPolygon(c.x, c.y, w.polygon))).toBe(true);
    }
    for (const b of wet.buildings) expect(grid.kind[grid.cellOf(b.entrance.x, b.entrance.y)]).toBe(CellKind.Free);
  });

  it("a road never ends up as water or rail", () => {
    for (const r of wet.roads) {
      for (const p of r.path ?? []) {
        const k = grid.kind[grid.cellOf(p.x, p.y)];
        expect(k === CellKind.Water || k === CellKind.Rail).toBe(false);
      }
    }
  });

  it("is the same map every time", () => {
    const again = cityFromOverpass({ elements: [...syntheticOverpass().elements, ...syntheticTerrain()] }, opts);
    expect(JSON.stringify(again.waters)).toBe(JSON.stringify(wet.waters));
    expect(JSON.stringify(again.rails)).toBe(JSON.stringify(wet.rails));
  });
});
