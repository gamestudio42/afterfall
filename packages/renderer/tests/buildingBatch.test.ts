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
