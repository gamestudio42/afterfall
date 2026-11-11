import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PROP_KINDS, ROOF_KINDS } from "../src/props";

async function load(asset: string) {
  const bytes = await readFile(new URL(`../../../apps/web/public/art/${asset}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  // Runtime kit materials draw the outward face only, unlike Blender's default.
  gltf.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh)
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) mat.side = THREE.FrontSide;
  });
  gltf.scene.updateMatrixWorld(true);
  return { scene: gltf.scene, bytes: bytes.length };
}

function release(scene: THREE.Object3D) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) mat.dispose();
  });
}

describe("shipped urban kit", () => {
  it("preserves authored colours within the download and draw budgets", async () => {
    for (const asset of [
      ...[...PROP_KINDS, ...ROOF_KINDS].map((name) => `props/${name}`),
      ...["wall", "gate", "tower", "farm", "well"].map((name) => `structures/${name}`),
    ]) {
      const { scene, bytes } = await load(asset);
      let triangles = 0,
        batches = 0;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        batches++;
        triangles += (obj.geometry.index?.count ?? obj.geometry.getAttribute("position").count) / 3;
        const colors = obj.geometry.getAttribute("color");
        expect(colors, asset).toBeDefined();
        expect(new Set(Array.from(colors.array)).size, asset).toBeGreaterThan(3);
        expect((obj.material as THREE.MeshStandardMaterial).vertexColors, asset).toBe(true);
      });
      expect(bytes, asset).toBeLessThanOrEqual(512 * 1024);
      expect(triangles, asset).toBeGreaterThan(100);
      expect(triangles, asset).toBeLessThanOrEqual(6500);
      expect(batches, asset).toBeLessThanOrEqual(3);
      release(scene);
    }
  });

  it("exposes the car hood and windscreen to rays from outside the vehicle", async () => {
    const car = await load("props/car");
    const hood = new THREE.Raycaster(new THREE.Vector3(0.35, 3, -1.65), new THREE.Vector3(0, -1, 0)).intersectObject(car.scene)[0];
    expect(hood?.point.y).toBeGreaterThan(0.72);
    expect(hood?.point.y).toBeLessThan(0.86);
    const ambulance = await load("props/ambulance");
    const windscreen = new THREE.Raycaster(new THREE.Vector3(0, 1.55, -4), new THREE.Vector3(0, 0, 1)).intersectObject(ambulance.scene)[0];
    expect((windscreen?.object as THREE.Mesh)?.material).toHaveProperty("name", "surface_glass");
    release(car.scene);
    release(ambulance.scene);
  });

  it("leaves the well shaft open down to the water", async () => {
    const { scene } = await load("structures/well");
    const hit = new THREE.Raycaster(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(0, -1, 0)).intersectObject(scene)[0];
    expect(hit?.point.y).toBeCloseTo(0.1925, 3);
    release(scene);
  });

  it("keeps the lamp arm connected at the authored head height", async () => {
    const { scene } = await load("props/lamp");
    const hit = new THREE.Raycaster(new THREE.Vector3(0.6, 6, 0), new THREE.Vector3(0, -1, 0)).intersectObject(scene)[0];
    expect(hit?.point.y).toBeCloseTo(5.575, 2);
    release(scene);
  });
});
