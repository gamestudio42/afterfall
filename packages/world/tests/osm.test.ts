import { describe, expect, it } from "vitest";
import { pointInPolygon } from "@afterfall/shared";
import { CellKind, NavGrid, OsmImportError, cityFromOverpass, overpassQuery } from "../src";
import { FIXTURE_CENTER, syntheticOverpass } from "./fixtures/osm";

const opts = { ...FIXTURE_CENTER, size: 480, label: "Test" };

/** A dense area that lacks a supermarket and a police station, with only two shops to promote. */
function sparseEssentialsOverpass() {
  const data = syntheticOverpass();
  const elements = data.elements.map((el) => {
    if (el.type !== "node") return el;
    if (el.tags?.shop === "supermarket") return { ...el, tags: { shop: "bakery" } };
    if (el.tags?.amenity === "police") return { ...el, tags: { shop: "clothes" } };
    return el;
  });
  return { elements };
}

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

  it("promotes essential buildings when there are few candidates", () => {
    const sparse = cityFromOverpass(sparseEssentialsOverpass(), opts);
    const types = new Set(sparse.buildings.map((b) => b.type));
    expect(types.has("supermarket")).toBe(true);
    expect(types.has("police")).toBe(true);
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

describe("a building drawn twice in OSM", () => {
  it("keeps one of a nested pair, so no volume cuts through another", () => {
    // A tower over its annex, or a building re-mapped as a part: both are stamped and both
    // are drawn, so the smaller one's walls cut through the larger one's roof and out over
    // the street. The fourth playtest report is those slabs.
    const data = syntheticOverpass();
    const kLon = 111_320 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);
    const at = (dx: number, dy: number) => ({
      lat: FIXTURE_CENTER.lat - dy / 111_132,
      lon: FIXTURE_CENTER.lon + dx / kLon,
    });
    const ring = (x0: number, x1: number, y0: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
    const withTwin = {
      elements: [
        ...data.elements,
        { type: "way" as const, id: 9001, tags: { building: "yes" }, geometry: ring(-70, -25, -70, -25) },
        { type: "way" as const, id: 9002, tags: { building: "yes" }, geometry: ring(-60, -35, -60, -35) },
      ],
    };
    const city = cityFromOverpass(withTwin, opts);
    expect(city.buildings.length).toBeGreaterThan(12);
    const inside = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    for (const a of city.buildings) {
      if (!a.footprint) continue;
      for (const b of city.buildings) {
        if (a === b || !b.footprint || b.footprint.length < 3) continue;
        const swallowed = a.footprint.every((p) => inside(p, b.footprint!));
        expect(swallowed && area(b.footprint) > area(a.footprint)).toBe(false);
      }
    }
  });
});

function area(poly: { x: number; y: number }[]): number {
  return Math.abs(
    poly.reduce((s, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return s + (p.x * q.y - q.x * p.y);
    }, 0) / 2,
  );
}

describe("street width and footprint", () => {
  const widthOf = (city: { roads: { width?: number }[] }) => city.roads.map((r) => r.width ?? 0);

  it("takes a street's width from the tag when OSM gives one", () => {
    const data = syntheticOverpass();
    const kLon = 111_320 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);
    const at = (dx: number, dy: number) => ({ lat: FIXTURE_CENTER.lat - dy / 111_132, lon: FIXTURE_CENTER.lon + dx / kLon });
    const withWidth = {
      elements: [
        ...data.elements,
        {
          type: "way" as const,
          id: 9101,
          tags: { highway: "residential", width: "5.5" },
          geometry: [at(-200, 30), at(200, 30)],
        },
      ],
    };
    const city = cityFromOverpass(withWidth, opts);
    expect(widthOf(city).some((w) => Math.abs(w - 5.5) < 0.01)).toBe(true);
  });

  it("leaves no footprint inside a carriageway", () => {
    // The ribbon is drawn from the way's own width, so a footprint mapped into the street
    // paints asphalt over the lot and the building reads as standing on the road.
    const city = cityFromOverpass(syntheticOverpass(), opts);
    for (const b of city.buildings) {
      for (const p of b.footprint ?? []) {
        for (const r of city.roads) {
          for (let i = 1; i < (r.path?.length ?? 0); i++) {
            const a = r.path![i - 1];
            const q = r.path![i];
            const dx = q.x - a.x;
            const dy = q.y - a.y;
            const l2 = dx * dx + dy * dy || 1;
            let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) - (r.width ?? 8) / 2;
            expect(d).toBeGreaterThan(-0.001);
          }
        }
      }
    }
  });
});

describe("landmarks", () => {
  const kLon = 111_320 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);
  const at = (dx: number, dy: number) => ({ lat: FIXTURE_CENTER.lat - dy / 111_132, lon: FIXTURE_CENTER.lon + dx / kLon });
  const ring = (x0: number, x1: number, y0: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

  function withWay(id: number, tags: Record<string, string>, geo: { lat: number; lon: number }[]) {
    const data = syntheticOverpass();
    return { elements: [...data.elements, { type: "way" as const, id, tags, geometry: geo }] };
  }

  it("keeps a tower's real height and marks the silhouette", () => {
    // The Eiffel Tower is one way: building=tower, height=330. The twenty-floor cap turned
    // it into a six-storey hall between its own legs.
    const city = cityFromOverpass(withWay(9201, { building: "tower", man_made: "tower", height: "330" }, ring(-60, 10, -60, 10)), opts);
    const tower = city.buildings.find((b) => b.landmark === "tower");
    expect(tower).toBeDefined();
    expect(tower!.height).toBeGreaterThan(300);
  });

  it("marks a church as a spire and a monument as an obelisk", () => {
    const church = cityFromOverpass(withWay(9202, { building: "church", "building:levels": "3" }, ring(20, 60, 20, 60)), opts);
    expect(church.buildings.some((b) => b.landmark === "spire")).toBe(true);
    const monument = cityFromOverpass(withWay(9203, { building: "yes", historic: "monument" }, ring(80, 110, 80, 110)), opts);
    expect(monument.buildings.some((b) => b.landmark === "obelisk")).toBe(true);
  });

  it("leaves an ordinary building without a landmark", () => {
    const city = cityFromOverpass(syntheticOverpass(), opts);
    expect(city.buildings.every((b) => !b.landmark)).toBe(true);
  });
});
