import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { heightAt, type BuildingDef, type CityMap, type TerrainDef } from "@afterfall/world";
import { cityWallGeometry } from "../src/cityMeshes";
import { buildMonuments } from "../src/monuments";
import { drape, groundGrid, rayGround, terrainTop } from "../src/terrainMesh";
import { BuildingBatch, buildingSeat } from "../src/buildingBatch";

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

describe("a building on a steep slope", () => {
  it("is raised until its roof clears the hill, on a plinth down to the foot", () => {
    // 1 m of rise per metre of x: across a 10 m house the ground climbs 10 m, past its 7 m roof.
    const cell = 4;
    const cols = 26;
    const heights: number[] = [];
    for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) heights.push(c * cell * 10);
    const t: TerrainDef = { cell, cols, rows: cols, heights, scale: 1, base: 0 };
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
    const seat = buildingSeat(b, t);
    expect(seat.foot).toBeCloseTo(40, 3);
    // The roof (base + 7) clears the highest ground (50) by 2.5 m.
    expect(seat.base + 7).toBeCloseTo(52.5, 3);
    const p = new BuildingBatch([b], t).mesh.geometry.getAttribute("position");
    let min = Infinity;
    for (let i = 0; i < p.count; i++) min = Math.min(min, p.getY(i));
    // The plinth reaches below the foot.
    expect(min).toBeLessThan(seat.foot);
  });

  it("stands on its foot when the slope is gentle", () => {
    expect(buildingSeat({ ...({} as BuildingDef), rect: { x: 0, y: 0, w: 10, h: 10 }, height: 7 } as BuildingDef, undefined)).toEqual({
      base: 0,
      foot: 0,
    });
  });
});

describe("a city wall", () => {
  const city = {
    walls: [
      {
        id: "w",
        path: [
          { x: 10, y: 50 },
          { x: 90, y: 50 },
        ],
        height: 6,
        width: 5,
      },
    ],
  } as unknown as CityMap;

  it("stands its height with merlons above the walk, from below the ground", () => {
    const g = cityWallGeometry(city)!;
    const p = g.getAttribute("position");
    let low = Infinity;
    let high = -Infinity;
    let merlonTops = 0;
    for (let i = 0; i < p.count; i++) {
      low = Math.min(low, p.getY(i));
      high = Math.max(high, p.getY(i));
      if (p.getY(i) > 6.5) merlonTops++;
    }
    expect(low).toBeCloseTo(-0.6, 3);
    expect(high).toBeCloseTo(6 + 1.1, 3);
    // About one merlon every 2.4 m on each side over 80 m.
    expect(merlonTops).toBeGreaterThan(30 * 2 * 6);
  });

  it("rides the ground on a hillside", () => {
    const g = cityWallGeometry({ ...city, terrain: slope() } as CityMap)!;
    const p = g.getAttribute("position");
    let eastTop = -Infinity;
    for (let i = 0; i < p.count; i++) if (p.getX(i) > 85) eastTop = Math.max(eastTop, p.getY(i));
    // At x = 90 the ground is 36 m up: the wall stands on it.
    expect(eastTop).toBeGreaterThan(36 + 6);
  });

  it("is nothing on a map without walls", () => {
    expect(cityWallGeometry({} as CityMap)).toBeNull();
  });
});

describe("monuments", () => {
  it("stand a figure on its pedestal, and Christ's arms span nearly its height", () => {
    const city = {
      monuments: [{ id: "c", x: 50, y: 50, kind: "open-arms", height: 30, pedestal: 8 }],
      terrain: slope(),
    } as unknown as CityMap;
    const mesh = buildMonuments(city)!;
    const p = mesh.geometry.getAttribute("position");
    let top = -Infinity;
    let west = Infinity;
    let east = -Infinity;
    for (let i = 0; i < p.count; i++) {
      top = Math.max(top, p.getY(i));
      west = Math.min(west, p.getX(i));
      east = Math.max(east, p.getX(i));
    }
    const ground = heightAt(slope(), 50, 50);
    expect(top).toBeCloseTo(ground + 8 + 30, 3);
    expect(east - west).toBeGreaterThan(30 * 0.9);
  });

  it("is nothing on a map without them", () => {
    expect(buildMonuments({} as CityMap)).toBeNull();
  });
});
