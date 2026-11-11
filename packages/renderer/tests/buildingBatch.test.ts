import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BuildingDef } from "@afterfall/world";
import { BuildingBatch, FLOOR, GROUPS, MODULE, facadeStyle } from "../src/buildingBatch";

function building(index: number, type: string, x: number, floors = 3, w = 10, d = 8): BuildingDef {
  return {
    id: `b${index}`,
    index,
    type: type as BuildingDef["type"],
    zone: "residential" as BuildingDef["zone"],
    rect: { x, y: 0, w, h: d },
    area: w * d,
    floors,
    height: floors * FLOOR + 0.6,
    entrance: { x: x + w / 2, y: -1 },
    facing: { x: 0, y: -1 },
  };
}

function groupOf(batch: BuildingBatch, name: (typeof GROUPS)[number]) {
  return batch.mesh.geometry.groups[GROUPS.indexOf(name)];
}

/** Vertices of one building in one group, read back from the geometry. */
function verticesIn(batch: BuildingBatch, name: (typeof GROUPS)[number]): number[][] {
  const g = groupOf(batch, name);
  const pos = batch.mesh.geometry.getAttribute("position");
  const out: number[][] = [];
  for (let v = g.start; v < g.start + g.count; v++) out.push([pos.getX(v), pos.getY(v), pos.getZ(v)]);
  return out;
}

describe("building batch", () => {
  it("maps building types to facade styles", () => {
    expect(facadeStyle("apartment")).toBe("residential");
    expect(facadeStyle("office")).toBe("office");
    expect(facadeStyle("warehouse")).toBe("industrial");
    expect(facadeStyle("something new")).toBe("residential");
  });

  it("draws one group per material, in the declared order", () => {
    const batch = new BuildingBatch([building(0, "house", 0)]);
    expect(batch.mesh.geometry.groups.map((g) => g.materialIndex)).toEqual(GROUPS.map((_, i) => i));
    expect((batch.mesh.material as THREE.Material[]).length).toBe(GROUPS.length);
    expect(groupOf(batch, "residential").count).toBeGreaterThan(0);
    expect(groupOf(batch, "office").count).toBe(0);
  });

  it("gives a shop a storefront ground floor and its style above it", () => {
    const batch = new BuildingBatch([building(0, "shop", 0, 3)]);
    const front = verticesIn(batch, "storefront");
    expect(front.length).toBeGreaterThan(0);
    expect(Math.max(...front.map((v) => v[1]))).toBeCloseTo(FLOOR, 5);
    const upper = verticesIn(batch, "office");
    expect(Math.min(...upper.map((v) => v[1]))).toBeCloseTo(FLOOR, 5);
    // The facade stops at the last floor line; the band above it is the cornice.
    expect(Math.max(...upper.map((v) => v[1]))).toBeCloseTo(3 * FLOOR, 5);
  });

  it("keeps a one-floor shop on its own style, with no storefront", () => {
    const batch = new BuildingBatch([building(0, "shop", 0, 1)]);
    expect(groupOf(batch, "storefront").count).toBe(0);
  });

  it("raises a parapet above the roof", () => {
    const b = building(0, "office", 0, 2);
    const batch = new BuildingBatch([b]);
    const trim = verticesIn(batch, "trim");
    expect(Math.max(...trim.map((v) => v[1]))).toBeGreaterThan(b.height + 0.3);
    const roof = verticesIn(batch, "roof");
    expect(roof.every((v) => Math.abs(v[1] - b.height) < 1e-6)).toBe(true);
  });

  it("runs facade UVs along the perimeter in module units, floors on whole numbers", () => {
    const batch = new BuildingBatch([building(4, "house", 0, 2, 12.8, 6.4)]);
    const g = groupOf(batch, "residential");
    const uv = batch.mesh.geometry.getAttribute("uv");
    const us: number[] = [];
    const vs: number[] = [];
    for (let v = g.start; v < g.start + g.count; v++) {
      us.push(uv.getX(v));
      vs.push(uv.getY(v));
    }
    // Perimeter 38.4 m is three modules, so U spans exactly 3 from its start.
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(38.4 / MODULE, 5);
    // The vertical shift is a whole number of floors.
    const v0 = Math.min(...vs) * MODULE;
    expect(v0 / FLOOR).toBeCloseTo(Math.round(v0 / FLOOR), 5);
  });

  it("maps a ray hit back to its building, whichever group the triangle is in", () => {
    const batch = new BuildingBatch([building(0, "house", 0), building(1, "shop", 30)]);
    const ray = new THREE.Raycaster(new THREE.Vector3(35, 1.5, -20), new THREE.Vector3(0, 0, 1));
    expect(batch.pick(ray)).toBe(1);
    const roofRay = new THREE.Raycaster(new THREE.Vector3(5, 50, 4), new THREE.Vector3(0, -1, 0));
    expect(batch.pick(roofRay)).toBe(0);
  });

  it("keeps ground-floor doorways flush while upper sills project from the wall", () => {
    const batch = new BuildingBatch([building(0, "house", 0)]);
    const rayAt = (height: number) => new THREE.Raycaster(new THREE.Vector3(5, height, -5), new THREE.Vector3(0, 0, 1));
    expect(rayAt(0.78).intersectObject(batch.mesh)[0].point.z).toBeCloseTo(0, 5);
    expect(rayAt(FLOOR + 0.78).intersectObject(batch.mesh)[0].point.z).toBeCloseTo(-0.22, 5);
    batch.dispose();
  });

  it("lights windows only where a building glows, and only once the mask has arrived", () => {
    const batch = new BuildingBatch([building(0, "house", 0), building(1, "house", 30)]);
    batch.setColors(0, new THREE.Color(1, 1, 1), new THREE.Color(0.7, 0.7, 0.7), 1);
    batch.setColors(1, new THREE.Color(1, 1, 1), new THREE.Color(0.7, 0.7, 0.7), 0);
    batch.commitColors();
    const glow = batch.mesh.geometry.getAttribute("glow");
    const g = groupOf(batch, "residential");
    const values = new Set<number>();
    for (let v = g.start; v < g.start + g.count; v++) values.add(glow.getX(v));
    expect([...values].sort()).toEqual([0, 1]);

    batch.setNight(1);
    expect(batch.materials.residential.emissiveIntensity).toBe(0);
    batch.setArt({ facade_residential_lit: new THREE.Texture() });
    expect(batch.materials.residential.emissiveIntensity).toBeGreaterThan(0);
    expect(batch.materials.office.emissiveIntensity).toBe(0);
    batch.setNight(0);
    expect(batch.materials.residential.emissiveIntensity).toBe(0);
  });

  it("tints the trim a little darker than the wall, and the roof with its own colour", () => {
    const batch = new BuildingBatch([building(0, "house", 0)]);
    batch.setColors(0, new THREE.Color(1, 0.5, 0.25), new THREE.Color(0.2, 0.2, 0.2), 0);
    const color = batch.mesh.geometry.getAttribute("color");
    expect(color.getX(groupOf(batch, "residential").start)).toBeCloseTo(1, 5);
    expect(color.getX(groupOf(batch, "trim").start)).toBeCloseTo(0.86, 5);
    expect(color.getX(groupOf(batch, "roof").start)).toBeCloseTo(0.2, 5);
  });
});

describe("large cities", () => {
  it("builds a map far bigger than the old stack could take", () => {
    // Ten blocks by ten is 435 buildings and about 43k triangles — smaller than a real
    // imported neighbourhood, and enough to overflow the stack when the groups were
    // concatenated with `push(...array)`.
    const city = Array.from({ length: 435 }, (_, i) => building(i, i % 3 === 0 ? "shop" : "house", (i % 21) * 14, 2 + (i % 4)));
    const batch = new BuildingBatch(city);
    const pos = batch.mesh.geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(40_000);
    // Every triangle belongs to a building that exists, read back through the API the
    // renderer itself uses for picking.
    const triangles = pos.count / 3;
    for (let t = 0; t < triangles; t += 97) {
      const owner = batch.ownerOfTriangle(t);
      expect(owner).toBeGreaterThanOrEqual(0);
      expect(owner).toBeLessThan(city.length);
    }
  });
});

describe("landmarks", () => {
  /** Widest radius of a building's geometry in each tenth of its height. */
  function profile(batch: BuildingBatch, height: number, cx: number, cz: number): number[] {
    const pos = batch.mesh.geometry.getAttribute("position");
    const bands = Array.from({ length: 10 }, () => 0);
    // One building, so every vertex in the geometry belongs to it.
    for (let v = 0; v < pos.count; v++) {
      const k = Math.min(9, Math.max(0, Math.floor((pos.getY(v) / height) * 10)));
      bands[k] = Math.max(bands[k], Math.hypot(pos.getX(v) - cx, pos.getZ(v) - cz));
    }
    return bands;
  }

  function tower(landmark: "tower" | "spire" | "obelisk"): BuildingBatch {
    const b: BuildingDef = {
      id: "t1",
      index: 0,
      type: "civic" as BuildingDef["type"],
      zone: "downtown" as BuildingDef["zone"],
      rect: { x: 0, y: 0, w: 100, h: 100 },
      footprint: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      area: 10_000,
      floors: 103,
      height: 330,
      landmark,
      entrance: { x: 50, y: -1 },
      facing: { x: 0, y: -1 },
    };
    return new BuildingBatch([b]);
  }

  it("a tower narrows as it rises", () => {
    // OSM maps the Eiffel Tower as the square around its four legs; extruded like a
    // building it is the hall between them, and it needs rings that step in.
    // Vertices only exist at the ring heights, so empty bands carry no width and the
    // comparison runs over the bands that do.
    const bands = profile(tower("tower"), 330, 50, 50).filter((w) => w > 0);
    expect(bands[0]).toBeGreaterThan(40);
    expect(bands[bands.length - 1]).toBeLessThan(bands[0] * 0.4);
    for (let k = 1; k < bands.length; k++) expect(bands[k]).toBeLessThanOrEqual(bands[k - 1] + 0.01);
  });

  it("a spire is slender at the top, an obelisk narrows once", () => {
    const spire = profile(tower("spire"), 330, 50, 50).filter((w) => w > 0);
    expect(spire[spire.length - 1]).toBeLessThan(spire[0] * 0.1);
    const obelisk = profile(tower("obelisk"), 330, 50, 50).filter((w) => w > 0);
    expect(obelisk[obelisk.length - 1]).toBeLessThan(obelisk[0] * 0.1);
  });

  it("a tall, slim building tapers even without a landmark tag", () => {
    const b: BuildingDef = {
      ...building(0, "office", 0, 10, 12, 12),
      height: 90,
      floors: 28,
    };
    const batch = new BuildingBatch([b]);
    const bands = profile(batch, 90, 6, 6).filter((w) => w > 0);
    expect(bands[bands.length - 1]).toBeLessThan(bands[0] * 0.85);
  });
});

describe("a courtyard", () => {
  it("leaves the roof open over the yard and walls it", () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ];
    const yard = [
      { x: 12, y: 12 },
      { x: 28, y: 12 },
      { x: 28, y: 28 },
      { x: 12, y: 28 },
    ];
    const b: BuildingDef = {
      ...building(0, "apartment", 0, 4, 40, 40),
      footprint: outer,
      holes: [yard],
      area: 40 * 40 - 16 * 16,
    };
    const batch = new BuildingBatch([b]);
    const pos = batch.mesh.geometry.getAttribute("position");
    // No roof triangle may cover the middle of the yard; one vertex inside it is enough to
    // catch a cap that ignored the hole.
    const roofGroup = GROUPS.indexOf("roof");
    const range = batch.mesh.geometry.groups[roofGroup];
    let inside = 0;
    for (let v = range.start; v < range.start + range.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      if (x > 13 && x < 27 && z > 13 && z < 27) inside++;
    }
    expect(inside).toBe(0);
    // And the yard has walls of its own: the residential group holds the building's four
    // sides plus the four of the courtyard.
    const wallVerts = batch.mesh.geometry.groups[GROUPS.indexOf("residential")].count;
    const solid = new BuildingBatch([{ ...b, holes: undefined }]);
    expect(wallVerts).toBeGreaterThan(solid.mesh.geometry.groups[GROUPS.indexOf("residential")].count);
  });
});
