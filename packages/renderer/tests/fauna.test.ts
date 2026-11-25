import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NavGrid, generateVariedCity } from "@afterfall/world";
import { Fauna, type FaunaWorld } from "../src/fauna";

const city = generateVariedCity(3);
const grid = NavGrid.fromCity(city);

function world(over: Partial<FaunaWorld> = {}): FaunaWorld {
  return {
    infectedNear: () => false,
    survivorNear: () => false,
    noises: [],
    walkable: (x, z) => grid.passable(x, z, "survivor"),
    path: (x0, z0, x1, z1) => grid.findPath(x0, z0, x1, z1, "survivor", 4000)?.points.map((p) => ({ x: p.x, z: p.y })) ?? null,
    daylight: 1,
    ...over,
  };
}

/** Where instance `i` of a fauna mesh stands, and how big it is drawn. */
function at(fauna: Fauna, name: string, i: number): { p: THREE.Vector3; scale: number } {
  const mesh = fauna.group.getObjectByName(name) as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, scale: s.x };
}

describe("the city's animals", () => {
  it("sit in flocks on roofs and in trees, and lift off at a shot nearby", () => {
    const fauna = new Fauna(city, 5);
    fauna.update(0.1, world());
    const birds = fauna.group.getObjectByName("fauna-birds") as THREE.InstancedMesh;
    expect(birds.count).toBeGreaterThan(40);
    // Perched: up off the ground, on a roof or a crown.
    const first = at(fauna, "fauna-birds", 0).p;
    expect(first.y).toBeGreaterThan(3);
    fauna.drain();
    fauna.update(0.1, world({ noises: [{ x: first.x, z: first.z }] }));
    const heard = fauna.drain().map((e) => e.sound);
    expect(heard).toContain("flutter");
    // A few seconds on, that bird is in the air and well away from where it sat.
    for (let t = 0; t < 30; t++) fauna.update(0.1, world());
    const flying = at(fauna, "fauna-birds", 0).p;
    expect(flying.distanceTo(first)).toBeGreaterThan(10);
  });

  it("roost at night unless something scares them", () => {
    const fauna = new Fauna(city, 5);
    fauna.update(0.1, world({ daylight: 0 }));
    const first = at(fauna, "fauna-birds", 0).p.clone();
    fauna.drain();
    for (let t = 0; t < 600; t++) fauna.update(0.1, world({ daylight: 0 }));
    expect(at(fauna, "fauna-birds", 0).p.distanceTo(first)).toBeLessThan(1);
    // And they do not sing in the dark.
    expect(fauna.drain().filter((e) => e.sound === "chirp" || e.sound === "caw")).toEqual([]);
  });

  it("run strays from the dead, and a dog barks at them", () => {
    const fauna = new Fauna(city, 5);
    fauna.update(0.1, world());
    const dog = at(fauna, "fauna-dogs", 0).p.clone();
    fauna.drain();
    const near = (x: number, z: number, r: number) => Math.hypot(x - dog.x, z - dog.z) < r;
    for (let t = 0; t < 40; t++) fauna.update(0.1, world({ infectedNear: near }));
    expect(fauna.drain().map((e) => e.sound)).toContain("bark");
    // Fleeing at a run: well away from where the dead are within a few seconds.
    expect(Math.hypot(at(fauna, "fauna-dogs", 0).p.x - dog.x, at(fauna, "fauna-dogs", 0).p.z - dog.z)).toBeGreaterThan(5);
  });

  it("keeps the rats in their holes by day and lets them out at night", () => {
    const fauna = new Fauna(city, 5);
    fauna.update(0.1, world());
    expect(at(fauna, "fauna-rats", 0).scale).toBe(0);
    fauna.update(0.1, world({ daylight: 0 }));
    expect(at(fauna, "fauna-rats", 0).scale).toBeGreaterThan(1);
  });

  it("is the same city of animals for the same seed", () => {
    const a = new Fauna(city, 9);
    const b = new Fauna(city, 9);
    for (let t = 0; t < 50; t++) {
      a.update(0.1, world());
      b.update(0.1, world());
    }
    for (const name of ["fauna-birds", "fauna-dogs", "fauna-cats"]) expect(at(a, name, 0).p.toArray()).toEqual(at(b, name, 0).p.toArray());
  });
});
