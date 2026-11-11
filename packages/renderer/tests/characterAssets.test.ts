import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTER_MORPHS } from "../src/characters";

/** A roll flip in a procedural limb can collapse it halfway between valid keys. */
describe("shipped character morph topology", () => {
  for (const asset of ["survivors/walker", "infected/infected"]) {
    it(`${asset} preserves surface area between adjacent locomotion keys`, async () => {
      const bytes = await readFile(new URL(`../../../apps/web/public/art/${asset}.glb`, import.meta.url));
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
      let triangles = 0;
      let worst = 1;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const edge = new THREE.Vector3();
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        expect(Object.keys(object.morphTargetDictionary ?? {})).toEqual(CHARACTER_MORPHS);
        const geo = object.geometry;
        const base = geo.getAttribute("position");
        const targets = geo.morphAttributes.position;
        const indices = geo.getIndex()!;
        const vertex = (out: THREE.Vector3, index: number, from: number, to: number, mix: number) => {
          out.fromBufferAttribute(base, index);
          for (let axis = 0; axis < 3; axis++) {
            const value = targets[from].getComponent(index, axis) * (1 - mix) + targets[to].getComponent(index, axis) * mix;
            out.setComponent(axis, out.getComponent(axis) + value);
          }
        };
        const area = (index: number, from: number, to: number, mix: number) => {
          vertex(a, indices.getX(index), from, to, mix);
          vertex(b, indices.getX(index + 1), from, to, mix);
          vertex(c, indices.getX(index + 2), from, to, mix);
          return b.sub(a).cross(edge.copy(c).sub(a)).length();
        };
        for (const [offset, count] of [
          [0, 8],
          [12, 4],
        ]) {
          for (let key = 0; key < count; key++) {
            const from = offset + key;
            const to = offset + ((key + 1) % count);
            for (let index = 0; index < indices.count; index += 3) {
              const reference = (area(index, from, to, 0) + area(index, from, to, 1)) / 2;
              if (reference < 1e-8) continue;
              worst = Math.min(worst, area(index, from, to, 0.5) / reference);
              triangles++;
            }
          }
        }
        geo.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
      expect(triangles).toBeGreaterThan(1000);
      expect(worst).toBeGreaterThan(0.12);
    });
  }
});
