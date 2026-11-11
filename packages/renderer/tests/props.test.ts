import { describe, expect, it } from "vitest";
import type { BuildingDef, CityMap } from "@afterfall/world";
import { CellKind } from "@afterfall/world";
import { placeProps, placeRoofProps, PROP_KINDS } from "../src/props";

const CELL = 2;

/** A 2x2 block city on a grid that is free everywhere. */
function city(blocks = 2): CityMap {
  const blockSize = 40;
  const roadWidth = 8;
  const width = blocks * (blockSize + roadWidth) + roadWidth;
  return {
    seed: 7,
    name: "Test",
    width,
    height: width,
    cellSize: CELL,
    blockSize,
    roadWidth,
    blocksX: blocks,
    blocksY: blocks,
    roads: [],
    intersections: [],
    buildings: [],
    parks: [],
    spawnPoints: [],
  } as CityMap;
}

/** Grid stub: `kind` decides what every cell is. */
function grid(kind: CellKind, size = 64, cell = CELL) {
  const kinds = new Uint8Array(size * size).fill(kind);
  return {
    kind: kinds,
    cell,
    cellOf(x: number, y: number): number {
      const cx = Math.max(0, Math.min(size - 1, Math.floor(x / cell)));
      const cy = Math.max(0, Math.min(size - 1, Math.floor(y / cell)));
      return cy * size + cx;
    },
  };
}

describe("placeProps", () => {
  it("draws only the kinds of the kit", () => {
    const out = placeProps(city(), grid(CellKind.Free), 7);
    for (const kind of out.keys()) expect(PROP_KINdsGuard(kind)).toBe(true);
    expect(out.size).toBeGreaterThan(0);
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const a = placeProps(city(), grid(CellKind.Free), 7);
    const b = placeProps(city(), grid(CellKind.Free), 7);
    const c = placeProps(city(), grid(CellKind.Free), 8);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
    expect(JSON.stringify([...a])).not.toBe(JSON.stringify([...c]));
  });

  it("puts nothing down when every cell is a building", () => {
    const out = placeProps(city(), grid(CellKind.Building), 7);
    expect(out.size).toBe(0);
  });

  it("keeps every prop inside the map and caps each kind", () => {
    const map = city(3);
    const out = placeProps(map, grid(CellKind.Free, 128), 7);
    for (const list of out.values()) {
      expect(list.length).toBeLessThanOrEqual(70);
      for (const p of list) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.z).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(map.width);
        expect(p.z).toBeLessThan(map.height);
        expect(p.scale).toBeGreaterThan(0.8);
      }
    }
  });
});

function PROP_KINdsGuard(kind: string): boolean {
  return (PROP_KINDS as readonly string[]).includes(kind);
}

describe("rooftop props", () => {
  function roofBuilding(index: number, type: string, floors: number, w = 20, d = 16, x = 0): BuildingDef {
    return {
      id: `b${index}`,
      index,
      type: type as BuildingDef["type"],
      zone: "residential" as BuildingDef["zone"],
      rect: { x, y: 0, w, h: d },
      area: w * d,
      floors,
      height: floors * 3.2 + 0.6,
      entrance: { x: x + w / 2, y: -1 },
      facing: { x: 0, y: -1 },
    };
  }

  const many = Array.from({ length: 60 }, (_, i) => roofBuilding(i, i % 2 ? "office" : "apartment", 2 + (i % 4), 20, 16, i * 30));

  it("sits every piece on its roof, inside the parapet", () => {
    const placed = placeRoofProps(many, 3);
    let n = 0;
    for (const [, list] of placed) {
      for (const p of list) {
        const b = many.find((o) => p.x >= o.rect.x && p.x <= o.rect.x + o.rect.w)!;
        expect(p.y).toBeCloseTo(b.height, 5);
        expect(p.x).toBeGreaterThan(b.rect.x + 0.9);
        expect(p.x).toBeLessThan(b.rect.x + b.rect.w - 0.9);
        expect(p.z).toBeGreaterThan(0.9);
        expect(p.z).toBeLessThan(b.rect.h - 0.9);
        n++;
      }
    }
    expect(n).toBeGreaterThan(60);
  });

  it("puts tanks on homes, AC units mostly on offices, and stairs only on three floors or more", () => {
    const placed = placeRoofProps(many, 3);
    const owner = (p: { x: number }) => many.find((o) => p.x >= o.rect.x && p.x <= o.rect.x + o.rect.w)!;
    for (const p of placed.get("roof_tank") ?? []) expect(owner(p).type).toBe("apartment");
    for (const p of placed.get("roof_stairs") ?? []) expect(owner(p).floors).toBeGreaterThanOrEqual(3);
    const ac = (placed.get("roof_ac") ?? []).map(owner);
    expect(ac.filter((b) => b.type === "office").length).toBeGreaterThan(ac.filter((b) => b.type === "apartment").length);
  });

  it("keeps pieces on one roof apart", () => {
    const placed = placeRoofProps(many, 3);
    const all = [...placed.values()].flat();
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThan(0.8);
  });

  it("dresses the same city the same way for the same seed", () => {
    const a = placeRoofProps(many, 9);
    const b = placeRoofProps(many, 9);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
  });

  it("leaves a roof too small for a piece bare", () => {
    expect([...placeRoofProps([roofBuilding(0, "office", 3, 2.4, 2.4)], 1).values()].flat()).toEqual([]);
  });
});

describe("district props", () => {
  it("gives an industrial block containers and a commercial one crates", () => {
    const map: CityMap = {
      ...city(2),
      buildings: [
        {
          id: "w",
          index: 0,
          type: "warehouse",
          zone: "industrial",
          rect: { x: 10, y: 10, w: 20, h: 20 },
          area: 400,
          floors: 1,
          height: 8,
          entrance: { x: 10, y: 20 },
          facing: { x: -1, y: 0 },
        },
      ] as BuildingDef[],
    };
    const kinds = new Set(placeProps(map, grid(CellKind.Free), 7).keys());
    expect(kinds.has("container")).toBe(true);
    expect(kinds.has("ambulance")).toBe(false);
  });

  it("does not invent sidewalk ambulances when the map has no roads", () => {
    const base = city(2);
    const withPharmacy: CityMap = {
      ...base,
      buildings: [
        {
          id: "p",
          index: 0,
          type: "pharmacy",
          zone: "commercial",
          rect: { x: 10, y: 10, w: 16, h: 16 },
          area: 256,
          floors: 2,
          height: 7,
          entrance: { x: 10, y: 18 },
          facing: { x: -1, y: 0 },
        },
      ] as BuildingDef[],
    };
    const plain: CityMap = { ...base, buildings: [] };
    expect(placeProps(withPharmacy, grid(CellKind.Free), 7).has("ambulance")).toBe(false);
    expect(placeProps(plain, grid(CellKind.Free), 7).has("ambulance")).toBe(false);
  });
});
