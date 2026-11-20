import { describe, expect, it } from "vitest";
import { buildTerrain, cityFromOverpass, decodeTerrarium, heightAt, heightRange, mapToLatLon, TERRAIN_SCALE, tileXY } from "../src";
import { FIXTURE_CENTER, syntheticOverpass } from "./fixtures/osm";

const center = { lat: -22.9519, lon: -43.2105 };
const size = 480;

describe("terrain", () => {
  it("maps a point back to where the importer put it", () => {
    // The importer projects lat/lon to x = (lon - lon0) * kLon + size / 2, y likewise.
    const city = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size, label: "t" });
    const b = city.buildings[0];
    const p = mapToLatLon(FIXTURE_CENTER, size, b.entrance.x, b.entrance.y);
    const kLon = 111_320 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);
    expect((p.lon - FIXTURE_CENTER.lon) * kLon + size / 2).toBeCloseTo(b.entrance.x, 6);
    expect((FIXTURE_CENTER.lat - p.lat) * 111_132 + size / 2).toBeCloseTo(b.entrance.y, 6);
  });

  it("stays flat where the area has no relief to speak of", () => {
    expect(buildTerrain(center, size, () => 31)).toBeNull();
    // About 1.3 m from one edge to the other: under the two metres that make a relief.
    expect(buildTerrain(center, size, (lat) => 31 + (lat - center.lat) * 300)).toBeNull();
  });

  it("gives up rather than guessing where the source has no data", () => {
    expect(buildTerrain(center, size, (lat) => (lat > center.lat ? NaN : 100))).toBeNull();
  });

  it("measures heights from the lowest point and draws them at the chosen scale", () => {
    // A slope rising 100 m from south to north, over a base of 240 m.
    const t = buildTerrain(center, size, (lat) => 240 + ((lat - center.lat) * 111_132 + size / 2) * (100 / size))!;
    expect(t.base).toBeCloseTo(240, 0);
    expect(t.scale).toBe(TERRAIN_SCALE);
    // y grows southward on the map: the south edge is the bottom of the slope.
    expect(heightAt(t, 240, size)).toBeCloseTo(0, 1);
    expect(heightAt(t, 240, 0)).toBeCloseTo(100 * TERRAIN_SCALE, 0);
    expect(heightAt(t, 240, size / 2)).toBeCloseTo(50 * TERRAIN_SCALE, 0);
  });

  it("interpolates between nodes and holds the edge past it", () => {
    const t = { cell: 4, cols: 3, rows: 3, heights: [0, 100, 200, 0, 100, 200, 0, 100, 200], scale: 1, base: 0 };
    expect(heightAt(t, 2, 4)).toBeCloseTo(5, 6);
    expect(heightAt(t, 6, 0)).toBeCloseTo(15, 6);
    expect(heightAt(t, 99, 0)).toBeCloseTo(20, 6);
    expect(heightAt(t, -5, 0)).toBeCloseTo(0, 6);
    expect(heightAt(undefined, 3, 3)).toBe(0);
  });

  it("finds the lowest and highest ground under a footprint", () => {
    const t = { cell: 4, cols: 3, rows: 3, heights: [0, 100, 200, 0, 100, 200, 0, 100, 200], scale: 1, base: 0 };
    const r = heightRange(t, [
      { x: 0, y: 0 },
      { x: 8, y: 8 },
    ]);
    expect(r).toEqual({ min: 0, max: 20 });
  });

  it("reads Terrarium tiles", () => {
    // 128 * 256 + 0 + 0 - 32768 = 0 m; Corcovado's summit, 704 m: 130, 192, 0.
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(130, 192, 0)).toBe(704);
    expect(decodeTerrarium(128, 10, 128)).toBeCloseTo(10.5, 6);
    // Web Mercator: the equator and the prime meridian meet in the middle of the world.
    expect(tileXY(0, 0, 1)).toEqual({ x: 1, y: 1 });
    const corner = tileXY(85.05112878, -180, 3);
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(0, 4);
  });
});
