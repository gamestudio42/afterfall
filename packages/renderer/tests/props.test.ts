import { describe, expect, it } from "vitest";
import type { CityMap } from "@afterfall/world";
import { CellKind } from "@afterfall/world";
import { placeProps, PROP_KINDS } from "../src/props";

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
