import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTER_POSES, RUN_KEYS, WALK_KEYS } from "../src/characters";
import { BONE_FLOATS, CharacterRig, type RigData } from "../src/rig";

interface Part {
  position: THREE.BufferAttribute;
  bind: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
}

async function load(asset: string): Promise<{ rig: CharacterRig; parts: Part[] }> {
  const bytes = await readFile(new URL(`../../../apps/web/public/art/${asset}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  let data: RigData | null = null;
  const parts: Part[] = [];
  gltf.scene.traverse((object) => {
    if (typeof object.userData.afterfall_rig === "string") data = JSON.parse(object.userData.afterfall_rig);
    if (!(object instanceof THREE.Mesh)) return;
    expect(Object.keys(object.morphTargetDictionary ?? {})).toEqual(["bind"]);
    const geo = object.geometry as THREE.BufferGeometry;
    parts.push({
      position: geo.getAttribute("position") as THREE.BufferAttribute,
      bind: geo.morphAttributes.position[0] as THREE.BufferAttribute,
      index: geo.getIndex()!,
    });
  });
  expect(data).not.toBeNull();
  return { rig: new CharacterRig(data!, CHARACTER_POSES), parts };
}

/** The mesh as the shader poses it: each vertex by its two bones and the first one's weight. */
function pose(rig: CharacterRig, part: Part, weights: number[]): Float32Array {
  const bones = new Float32Array(rig.bones * BONE_FLOATS);
  rig.skin(weights, bones, 0);
  const out = new Float32Array(part.position.count * 3);
  for (let i = 0; i < part.position.count; i++) {
    const x = part.position.getX(i);
    const y = part.position.getY(i);
    const z = part.position.getZ(i);
    const w = part.bind.getZ(i);
    for (const [bone, share] of [
      [Math.round(part.bind.getX(i)), w],
      [Math.round(part.bind.getY(i)), 1 - w],
    ]) {
      const m = bone * BONE_FLOATS;
      for (let row = 0; row < 3; row++)
        out[i * 3 + row] +=
          share * (bones[m + row * 4] * x + bones[m + row * 4 + 1] * y + bones[m + row * 4 + 2] * z + bones[m + row * 4 + 3]);
    }
  }
  return out;
}

function key(index: number, mix = 0, next = index): number[] {
  const weights = Array<number>(CHARACTER_POSES.length).fill(0);
  weights[index] += 1 - mix;
  weights[next] += mix;
  return weights;
}

describe("shipped character rigs", () => {
  for (const asset of ["survivors/walker", "infected/infected"]) {
    it(`${asset} keeps its limbs half way between locomotion keys`, async () => {
      const { rig, parts } = await load(asset);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const area = (p: Float32Array, index: THREE.BufferAttribute, t: number) => {
        a.fromArray(p, index.getX(t) * 3);
        b.fromArray(p, index.getX(t + 1) * 3);
        c.fromArray(p, index.getX(t + 2) * 3);
        return b.sub(a).cross(c.sub(a)).length();
      };
      let triangles = 0;
      let worst = 1;
      let worstTotal = 1;
      for (const [offset, count] of [
        [0, WALK_KEYS],
        [WALK_KEYS, RUN_KEYS],
      ]) {
        for (let k = 0; k < count; k++) {
          const from = offset + k;
          const to = offset + ((k + 1) % count);
          let before = 0;
          let between = 0;
          for (const part of parts) {
            const p0 = pose(rig, part, key(from));
            const p1 = pose(rig, part, key(to));
            const half = pose(rig, part, key(from, 0.5, to));
            for (let t = 0; t < part.index.count; t += 3) {
              const reference = (area(p0, part.index, t) + area(p1, part.index, t)) / 2;
              const mid = area(half, part.index, t);
              before += reference;
              between += mid;
              if (reference < 1e-8) continue;
              worst = Math.min(worst, mid / reference);
              triangles++;
            }
          }
          worstTotal = Math.min(worstTotal, between / before);
        }
      }
      expect(triangles).toBeGreaterThan(10000);
      // Blending vertex positions, the body lost area half way between keys, worst at a
      // triangle near 0.12. Rotating bones keeps the skin: a body loses no area overall,
      // and the worst triangle is one at a joint that folds between the two keys anyway.
      expect(worstTotal).toBeGreaterThan(0.99);
      expect(worst).toBeGreaterThan(0.3);
    });

    it(`${asset} stands on the ground in every key`, async () => {
      const { rig, parts } = await load(asset);
      for (let k = 0; k < WALK_KEYS + RUN_KEYS; k++) {
        let low = Infinity;
        for (const part of parts) {
          const p = pose(rig, part, key(k));
          for (let i = 1; i < p.length; i += 3) low = Math.min(low, p[i]);
        }
        // The planted sole is at the ground; in a run's flight both feet may be up.
        expect(low).toBeGreaterThan(-0.03);
        expect(low).toBeLessThan(k < WALK_KEYS ? 0.03 : 0.2);
      }
    });
  }
});
