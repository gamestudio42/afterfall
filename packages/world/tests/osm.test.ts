import { describe, expect, it } from "vitest";
import { pointInPolygon } from "@afterfall/shared";
import { CellKind, NavGrid, OsmImportError, cityFromOverpass, overpassQuery } from "../src";
import { FIXTURE_CENTER, syntheticOverpass } from "./fixtures/osm";

const opts = { ...FIXTURE_CENTER, size: 480, label: "Test" };

describe("OpenStreetMap import", () => {
  const city = cityFromOverpass(syntheticOverpass(), opts);
  const grid = NavGrid.fromCity(city);

  it("builds a map of the requested size with real footprints", () => {
    expect(city.width).toBe(480);
    expect(city.height).toBe(480);
    expect(city.buildings.length).toBeGreaterThan(80);
    for (const b of city.buildings) {
      expect(b.footprint!.length).toBeGreaterThanOrEqual(3);
      expect(b.area).toBeGreaterThan(30);
      for (const p of b.footprint!) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(480);
        expect(p.y).toBeLessThan(480);
      }
    }
    expect(city.source?.kind).toBe("osm");
    expect(city.source?.attribution).toContain("OpenStreetMap");
  });

  it("keeps rotated outlines, not boxes", () => {
    const school = city.buildings.find((b) => b.type === "school")!;
    expect(school).toBeDefined();
    expect(school.footprint!.length).toBe(6);
    // The L leaves part of its bounding box empty.
    expect(school.area).toBeLessThan(school.rect.w * school.rect.h * 0.75);
  });

  it("types buildings from tags and points of interest", () => {
    const types = new Set(city.buildings.map((b) => b.type));
    for (const t of ["house", "school", "supermarket", "police", "pharmacy", "apartment"]) expect(types).toContain(t);
  });

  it("places every door on a free cell reachable from the map border", () => {
    const start = city.spawnPoints[0];
    for (const b of city.buildings) {
      const c = grid.cellOf(b.entrance.x, b.entrance.y);
      expect(grid.kind[c]).toBe(CellKind.Free);
      expect(pointInPolygon(b.entrance.x, b.entrance.y, b.footprint!)).toBe(false);
      expect(grid.findPath(start.x, start.y, b.entrance.x, b.entrance.y, "infected")).not.toBeNull();
    }
  });

  it("finds horde entry points where streets leave the map", () => {
    expect(city.spawnPoints.length).toBeGreaterThanOrEqual(4);
    for (const p of city.spawnPoints) {
      const edge = Math.min(p.x, p.y, 480 - p.x, 480 - p.y);
      expect(edge).toBeLessThan(8);
    }
  });

  it("imports roads and parks as shapes, ignoring footpaths", () => {
    expect(city.roads.every((r) => r.path && r.path.length >= 2 && r.width! >= 4)).toBe(true);
    expect(city.parks.length).toBe(1);
    expect(city.parks[0].polygon!.length).toBeGreaterThanOrEqual(4);
    expect(city.parks[0].trees.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const again = cityFromOverpass(syntheticOverpass(), opts);
    expect(JSON.stringify(again)).toBe(JSON.stringify(city));
  });

  it("rejects areas without enough buildings", () => {
    const empty = { elements: syntheticOverpass().elements.filter((e) => !e.tags?.building) };
    expect(() => cityFromOverpass(empty, opts)).toThrow(OsmImportError);
  });

  it("builds an Overpass query around the area", () => {
    const q = overpassQuery(FIXTURE_CENTER.lat, FIXTURE_CENTER.lon, 480);
    expect(q).toContain('way["building"]');
    expect(q).toContain("out geom");
  });
});
