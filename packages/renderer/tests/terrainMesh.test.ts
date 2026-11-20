import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { heightAt, type BuildingDef, type TerrainDef } from "@afterfall/world";
import { drape, groundGrid, rayGround, terrainTop } from "../src/terrainMesh";
import { BuildingBatch } from "../src/buildingBatch";

/** A 40 m slope over a 100 m map: the ground rises 0.4 m per metre of x. */
function slope(): TerrainDef {
  const cell = 4;
  const cols = 26;
  const heights: number[] = [];
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) heights.push(c * cell * 0.4 * 10);
  return { cell, cols, rows: cols, heights, scale: 1, base: 0 };
}

describe("draping flat ground over the relief", () => {
  it("leaves a flat map alone", () => {
    const g = new THREE.PlaneGeometry(50, 50);
    expect(drape(g, undefined)).toBe(g);
  });

  it("splits a big plane until it can follow the slope, and lays every vertex on it", () => {
    const t = slope();
    const g = new THREE.PlaneGeometry(40, 40);
    g.rotateX(-Math.PI / 2);
    g.translate(30, 0.04, 30);
    const d = drape(g, t);
    const p = d.getAttribute("position");
    expect(p.count).toBeGreaterThan(100);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(0.04 + heightAt(t, p.getX(i), p.getZ(i)), 4);
    // The normals lean back from the slope.
    expect(d.getAttribute("normal").getX(0)).toBeLessThan(-0.2);
  });

  it("keeps the attributes it does not know, interpolated", () => {
    const g = new THREE.PlaneGeometry(40, 40);
    g.rotateX(-Math.PI / 2);
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(4 * 4).fill(0.5), 4));
    const d = drape(g, slope());
    expect(d.getAttribute("color").itemSize).toBe(4);
    expect(d.getAttribute("color").getW(7)).toBeCloseTo(0.5, 6);
  });
});

describe("the base ground", () => {
  it("is one quad on a flat map and a grid on a hillside", () => {
    expect(groundGrid(0, 0, 100, 100, -0.05, undefined).getAttribute("position").count).toBe(4);
    const t = slope();
    const g = groundGrid(0, 0, 100, 100, -0.05, t);
    const p = g.getAttribute("position");
    expect(p.count).toBe(26 * 26);
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
    expect(top).toBeCloseTo(-0.05 + terrainTop(t), 3);
  });
});

describe("picking the ground", () => {
  it("finds the plane on a flat map", () => {
    const hit = rayGround(new THREE.Vector3(10, 50, 10), new THREE.Vector3(0, -1, 0), undefined, 0)!;
    expect(hit.x).toBeCloseTo(10, 6);
    expect(hit.y).toBeCloseTo(0, 6);
  });

  it("finds the hillside where the ray meets it, not the plane below", () => {
    const t = slope();
    // Looking down at 45 degrees, from x = 0 towards +x, over ground that rises 0.4 per metre.
    const dir = new THREE.Vector3(1, -1, 0).normalize();
    const hit = rayGround(new THREE.Vector3(0, 60, 50), dir, t, terrainTop(t))!;
    expect(hit).not.toBeNull();
    // The ray is at 60 - x; the ground at 0.4 x: they meet at x = 60 / 1.4.
    expect(hit.x).toBeCloseTo(60 / 1.4, 1);
    expect(hit.y).toBeCloseTo(heightAt(t, hit.x, hit.z), 1);
  });
});

describe("a building on a slope", () => {
  it("stands on the lowest ground under its outline", () => {
    const b: BuildingDef = {
      id: "b",
      index: 0,
      type: "house",
      zone: "residential",
      rect: { x: 40, y: 40, w: 10, h: 10 },
      area: 100,
      floors: 2,
      height: 7,
      entrance: { x: 45, y: 39 },
      facing: { x: 0, y: -1 },
    };
    const t = slope();
    const batch = new BuildingBatch([b], t);
    const p = batch.mesh.geometry.getAttribute("position");
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < p.count; i++) {
      min = Math.min(min, p.getY(i));
      max = Math.max(max, p.getY(i));
    }
    // The low side is at x = 40, 16 m up the slope.
    expect(min).toBeCloseTo(16, 3);
    expect(max).toBeCloseTo(16 + 7 + 0.55, 1);
    // The facade shader measures grime from that base.
    expect(batch.mesh.geometry.getAttribute("groundY").getX(0)).toBeCloseTo(16, 3);
  });
});
