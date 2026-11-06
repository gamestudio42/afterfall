import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BuildingDef } from "@afterfall/world";
import { Doors, doorSpot } from "../src/doors";

function building(
  index: number,
  facing: { x: number; y: number },
  entrance: { x: number; y: number },
  footprint?: { x: number; y: number }[],
): BuildingDef {
  return {
    id: `b${index}`,
    index,
    type: "house" as BuildingDef["type"],
    zone: "residential" as BuildingDef["zone"],
    rect: { x: 0, y: 0, w: 10, h: 8 },
    footprint,
    area: 80,
    floors: 2,
    height: 7,
    entrance,
    facing,
  };
}

describe("doors", () => {
  it("puts the door on the wall behind the entrance, facing out", () => {
    const s = doorSpot(building(0, { x: 0, y: -1 }, { x: 5, y: -1 }))!;
    expect(s.x).toBeCloseTo(5, 5);
    expect(s.y).toBeCloseTo(0, 5);
    expect(s.ny).toBe(-1);
  });

  it("finds the wall of a slanted real footprint", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 15 },
      { x: -5, y: 10 },
    ];
    // Outward normal of the first edge, entrance 1.6 m out from its middle.
    const n = { x: 5 / Math.hypot(10, 5), y: -10 / Math.hypot(10, 5) };
    const s = doorSpot(building(0, n, { x: 5 + n.x * 1.6, y: 2.5 + n.y * 1.6 }, poly))!;
    expect(s.x).toBeCloseTo(5, 4);
    expect(s.y).toBeCloseTo(2.5, 4);
  });

  it("draws no door for an entrance far from its building", () => {
    expect(doorSpot(building(0, { x: 0, y: -1 }, { x: 5, y: -20 }))).toBeNull();
  });

  it("instances a door, a canopy and a step per building, turned to the street", () => {
    const doors = new Doors([building(0, { x: 0, y: -1 }, { x: 5, y: -1 }), building(1, { x: 1, y: 0 }, { x: 11, y: 4 })]);
    const meshes = doors.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBe(3);
    for (const m of meshes) expect(m.count).toBe(2);
    // The second door faces +x: its local +z must point along +x.
    const mat = new THREE.Matrix4();
    meshes[0].getMatrixAt(1, mat);
    const front = new THREE.Vector3(0, 0, 1).transformDirection(mat);
    expect(front.x).toBeCloseTo(1, 5);
    expect(new THREE.Vector3().setFromMatrixPosition(mat).x).toBeCloseTo(10.02, 5);
  });

  it("takes its map once, clamped, and leaves the flat colour until then", () => {
    const doors = new Doors([building(0, { x: 0, y: -1 }, { x: 5, y: -1 })]);
    const mat = (doors.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    doors.setMap(null);
    expect(mat.map).toBeNull();
    const tex = new THREE.Texture();
    doors.setMap(tex);
    expect(mat.map).toBe(tex);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });
});
