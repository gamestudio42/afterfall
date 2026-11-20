import { describe, expect, it } from "vitest";
import { pointInPolygon, polygonCentroid } from "@afterfall/shared";
import { CellKind, MIN_BUILDINGS, NavGrid, OsmImportError, cityFromOverpass, overpassQuery } from "../src";
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

  it("loads a site with only a handful of buildings, and not one with fewer", () => {
    // The Taj Mahal has nine buildings in its 480 m, Christ the Redeemer ten: a lone
    // monument is still a place to play, a poor one.
    const keep = (n: number) => {
      let left = n;
      return { elements: syntheticOverpass().elements.filter((e) => !e.tags?.building || left-- > 0) };
    };
    const few = cityFromOverpass(keep(MIN_BUILDINGS + 6), opts);
    expect(few.buildings.length).toBeGreaterThanOrEqual(MIN_BUILDINGS);
    // Fewer than the twelve the importer used to demand.
    expect(few.buildings.length).toBeLessThan(12);
    expect(() => cityFromOverpass(keep(MIN_BUILDINGS - 2), opts)).toThrow(OsmImportError);
  });

  it("keeps a city's footpaths out of its streets", () => {
    // The fixture's grid is kilometres of street; its one footway is not walked as one.
    expect(city.roads.some((r) => r.trail)).toBe(false);
  });

  it("walks a site's paths where it has no streets", () => {
    // Machu Picchu and Chichén Itzá: paths and steps, not a street in 480 m.
    const site = {
      elements: syntheticOverpass().elements.map((e) =>
        e.tags?.highway ? { ...e, tags: { ...e.tags, highway: e.tags.highway === "secondary" ? "steps" : "footway" } } : e,
      ),
    };
    const c = cityFromOverpass(site, opts);
    expect(c.roads.length).toBeGreaterThan(0);
    expect(c.roads.every((r) => r.trail)).toBe(true);
    expect(c.roads.every((r) => (r.width ?? 0) <= 6)).toBe(true);
    expect(c.buildings.length).toBeGreaterThanOrEqual(MIN_BUILDINGS);
    expect(c.spawnPoints.length).toBeGreaterThan(0);
  });

  it("adds the paths to a site whose streets are few", () => {
    // One street across the area and paths everywhere else, like Christ the Redeemer.
    let first = true;
    const site = {
      elements: syntheticOverpass().elements.map((e) => {
        if (!e.tags?.highway || e.tags.highway === "footway") return e;
        if (e.tags.highway === "secondary" && first) {
          first = false;
          return e;
        }
        return { ...e, tags: { ...e.tags, highway: "path" } };
      }),
    };
    const c = cityFromOverpass(site, opts);
    expect(c.roads.some((r) => r.trail)).toBe(true);
    expect(c.roads.some((r) => !r.trail)).toBe(true);
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

  it("stands a lattice tower on four piers and leaves the ground between them open", () => {
    // The Eiffel Tower is tagged tower:construction=lattice; its footprint is the square
    // around its legs, and the esplanade under it is walkable ground, not a building.
    const tags = { building: "tower", man_made: "tower", height: "330", "tower:construction": "lattice" };
    const city = cityFromOverpass(withWay(9204, tags, ring(-60, 40, -60, 40)), opts);
    const tower = city.buildings.find((b) => b.landmark === "lattice")!;
    expect(tower).toBeDefined();
    const grid = NavGrid.fromCity(city);
    const r = tower.rect;
    const cell = (x: number, y: number) => grid.kind[grid.cellOf(x, y)];
    // The middle of the base is open, the corners are piers.
    expect(cell(r.x + r.w / 2, r.y + r.h / 2)).not.toBe(CellKind.Building);
    expect(cell(r.x + 2, r.y + 2)).toBe(CellKind.Building);
    expect(cell(r.x + r.w - 2, r.y + r.h - 2)).toBe(CellKind.Building);
    let blocked = 0;
    for (let i = 0; i < grid.kind.length; i++) if (grid.buildingAt[i] === tower.index) blocked++;
    const all = (r.w * r.h) / (grid.cell * grid.cell);
    // Four piers of a fifth of the side each: about 16% of the base, never the whole of it.
    expect(blocked / all).toBeGreaterThan(0.08);
    expect(blocked / all).toBeLessThan(0.25);
  });

  it("draws a pyramid tomb to its apex, at its real height", () => {
    // The Great Pyramid: tomb=pyramid, height 138.8, and also building:levels=40, which the
    // twenty-floor cap used to turn into a 65 m block of flats.
    const tags = { building: "yes", historic: "tomb", tomb: "pyramid", height: "138.8", "building:levels": "40" };
    const city = cityFromOverpass(withWay(9205, tags, ring(-60, 40, -60, 40)), opts);
    const p = city.buildings.find((b) => b.id === "osm9205")!;
    expect(p.landmark).toBe("pyramid");
    expect(p.height).toBeGreaterThan(130);
  });

  it("tells a pyramid roof that is the whole building from a house's pyramid roof", () => {
    const whole = { building: "yes", "roof:shape": "pyramidal", height: "30", "roof:height": "30" };
    const house = { building: "house", "roof:shape": "pyramidal", height: "9", "roof:height": "3" };
    expect(cityFromOverpass(withWay(9206, whole, ring(-60, 40, -60, 40)), opts).buildings.find((b) => b.id === "osm9206")!.landmark).toBe(
      "pyramid",
    );
    expect(
      cityFromOverpass(withWay(9207, house, ring(-60, 40, -60, 40)), opts).buildings.find((b) => b.id === "osm9207")!.landmark,
    ).toBeUndefined();
  });

  it("steps a building=pyramid, and opens an amphitheatre to its height", () => {
    const stepped = cityFromOverpass(withWay(9208, { building: "pyramid", height: "30" }, ring(-60, 40, -60, 40)), opts);
    expect(stepped.buildings.find((b) => b.id === "osm9208")!.landmark).toBe("stepped");
    // An amphitheatre without a height rises about a quarter of its width.
    const arena = cityFromOverpass(withWay(9209, { building: "amphitheatre" }, ring(-60, 40, -60, 20)), opts);
    const a = arena.buildings.find((b) => b.id === "osm9209")!;
    expect(a.landmark).toBe("amphitheatre");
    expect(a.height).toBeGreaterThan(80 * 0.2);
    expect(a.height).toBeLessThan(80 * 0.35);
  });

  it("domes a mausoleum, a mosque and a dome roof, and keeps the landmark's own colour", () => {
    const taj = cityFromOverpass(
      withWay(9210, { building: "yes", tomb: "mausoleum", "roof:colour": "white" }, ring(-60, 40, -60, 40)),
      opts,
    );
    const t = taj.buildings.find((b) => b.id === "osm9210")!;
    expect(t.landmark).toBe("dome");
    expect(t.colour).toBe(0xece8de);
    // A 100 m square platform: the Taj Mahal's four minarets at its corners.
    expect(t.minarets).toHaveLength(4);
    // An untagged dome rises about six tenths of its width.
    expect(t.height).toBeGreaterThan(50);
    const mosque = cityFromOverpass(withWay(9211, { building: "mosque" }, ring(-60, 40, -60, 40)), opts);
    expect(mosque.buildings.find((b) => b.id === "osm9211")?.landmark).toBe("dome");
    const roof = cityFromOverpass(
      withWay(9212, { building: "yes", "roof:shape": "onion", "building:colour": "#a0b0c0" }, ring(-60, 0, -60, 0)),
      opts,
    );
    const r = roof.buildings.find((b) => b.id === "osm9212")!;
    expect(r.landmark).toBe("dome");
    expect(r.colour).toBe(0xa0b0c0);
    // Not a mausoleum, and too small a platform for the Taj Mahal's plan: no invented minarets.
    expect(r.minarets).toBeUndefined();
  });

  it("makes a rock-cut tomb a carved facade, about twice as tall as it is long", () => {
    // Petra's Treasury: building=yes, historic=tomb, tomb=rock-cut, on an outline 18 m long
    // that rises 39 m. A 20 m one comes out a little over 40.
    const t = cityFromOverpass(withWay(9216, { building: "yes", historic: "tomb", tomb: "rock-cut" }, ring(-60, -40, -60, -48)), opts);
    const b = t.buildings.find((x) => x.id === "osm9216")!;
    expect(b.landmark).toBe("rockcut");
    expect(b.height).toBeGreaterThan(40);
    expect(b.height).toBeLessThan(50);
  });

  it("makes a defensive tower a watchtower, and keeps an ordinary building in the palette", () => {
    const tower = cityFromOverpass(
      withWay(9213, { building: "tower", man_made: "tower", "tower:type": "defensive", height: "11" }, ring(-60, -40, -60, -40)),
      opts,
    );
    const t = tower.buildings.find((b) => b.id === "osm9213")!;
    expect(t.landmark).toBe("watchtower");
    // 11 m, kept to the game's whole storeys: three, 10.2 m with the parapet band.
    expect(t.height).toBeCloseTo(10.2, 1);
    // Untagged, it stands a little taller than it is wide (20 m here).
    const keep = cityFromOverpass(withWay(9215, { building: "tower", "tower:type": "defensive" }, ring(-60, -40, -60, -40)), opts);
    const k = keep.buildings.find((b) => b.id === "osm9215")!;
    expect(k.height).toBeGreaterThan(20);
    expect(k.height).toBeLessThan(28);
    const plain = cityFromOverpass(withWay(9214, { building: "yes", "building:colour": "white" }, ring(-60, -40, -60, -40)), opts);
    expect(plain.buildings.find((b) => b.id === "osm9214")?.colour).toBeUndefined();
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

describe("a building with a courtyard", () => {
  const kLon = 111_320 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);
  const at = (dx: number, dy: number) => ({ lat: FIXTURE_CENTER.lat - dy / 111_132, lon: FIXTURE_CENTER.lon + dx / kLon });
  const ring = (x0: number, x1: number, y0: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

  function withCourtyard() {
    const data = syntheticOverpass();
    return {
      elements: [
        ...data.elements,
        {
          type: "relation" as const,
          id: 9501,
          tags: { type: "multipolygon", building: "yes" },
          members: [
            { type: "way", ref: 1, role: "outer", geometry: ring(-90, -40, -90, -40) },
            { type: "way", ref: 2, role: "inner", geometry: ring(-78, -52, -78, -52) },
          ],
        },
      ],
    };
  }

  it("imports the outer ring and keeps the courtyard open", () => {
    // Only ways were read, so a block mapped as a multipolygon did not exist on the map at
    // all — and a courtyard that arrived as a plain way was stamped solid.
    const city = cityFromOverpass(withCourtyard(), opts);
    const block = city.buildings.find((b) => b.holes?.length);
    expect(block).toBeDefined();
    expect(block!.holes).toHaveLength(1);
    // 50x50 outer, 26x26 hole: the area is what stands, not what it encloses.
    expect(block!.area).toBeLessThan(50 * 50);
    expect(block!.area).toBeGreaterThan(50 * 50 - 26 * 26 - 100);
  });

  it("joins an outline mapped as several ways before reading it", () => {
    // The Colosseum's outline is four ways end to end, the pyramid at Chichén Itzá's
    // seventy-four. Read one by one, each piece was closed by a chord: the Colosseum lost
    // half its footprint and the pyramid vanished.
    const sq = ring(-90, -40, -90, -40);
    const pieces = [sq.slice(0, 2), sq.slice(1, 3), sq.slice(2, 4).reverse(), sq.slice(3, 5)];
    const data = syntheticOverpass();
    const city = cityFromOverpass(
      {
        elements: [
          ...data.elements,
          {
            type: "relation" as const,
            id: 9502,
            tags: { type: "multipolygon", building: "yes" },
            members: pieces.map((geometry, k) => ({ type: "way", ref: 10 + k, role: "outer", geometry })),
          },
        ],
      },
      opts,
    );
    const block = city.buildings.find((b) => b.id === "osm9502");
    expect(block).toBeDefined();
    expect(block!.area).toBeGreaterThan(50 * 50 - 60);
  });

  it("leaves the courtyard walkable in the navigation grid", () => {
    const city = cityFromOverpass(withCourtyard(), opts);
    const block = city.buildings.find((b) => b.holes?.length)!;
    const g = NavGrid.fromCity(city);
    const c = polygonCentroid(block.holes![0]);
    const cell = g.index(Math.floor(c.x / g.cell), Math.floor(c.y / g.cell));
    expect(g.kind[cell]).toBe(CellKind.Free);
    // And the ring around it is solid.
    const wall = { x: block.footprint![0].x + 1, y: block.footprint![0].y + 1 };
    expect(g.kind[g.index(Math.floor(wall.x / g.cell), Math.floor(wall.y / g.cell))]).toBe(CellKind.Building);
  });
});
