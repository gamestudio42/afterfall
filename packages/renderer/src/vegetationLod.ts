import * as THREE from "three";
import { hash2 } from "./reclamation";

/**
 * Level of detail for the instanced plants. The Refloreste kit ships LOD1 and LOD2
 * for trunks and bushes but none for the crowns of the manacá and the pequi, which
 * are 3,556 and 1,080 triangles of leaf cards each, drawn twice (colour and shadow).
 * Those crowns are most of the frame, so the far levels are made here, by keeping a
 * share of the cards and growing the survivors to cover the same area.
 */

/** Share of leaf cards each level keeps. Level 0 is the model as authored. */
export const LEAF_KEEP = [1, 0.4, 0.14] as const;

/** Camera distance in metres past which a plant drops to level 1, then level 2. */
export const LOD_DISTANCE = [85, 160] as const;
/** Slack around a threshold before a plant changes level again, so none flickers. */
export const LOD_HYSTERESIS = 8;
/**
 * A plant is dropped from every draw when its crown is this far outside the view.
 * The margin keeps the shadow of a tree just off screen, which falls into the frame.
 */
export const CULL_MARGIN = 40;
export const CULLED = 255;

/**
 * Keeps a deterministic share of the quads of a leaf mesh and grows each survivor
 * about its own centre, so the crown keeps most of its cover with fewer triangles.
 * Quads are four consecutive vertices, as the kit exports them.
 */
export function decimateQuads(geo: THREE.BufferGeometry, keep: number): THREE.BufferGeometry {
  const position = geo.getAttribute("position");
  const quads = Math.floor(position.count / 4);
  const kept: number[] = [];
  for (let q = 0; q < quads; q++) if (hash2(q, 5, 131) < keep) kept.push(q);
  if (!kept.length && quads) kept.push(0);
  const grow = keep >= 1 ? 1 : Math.pow(keep, -0.4);
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name);
    const size = attr.itemSize;
    const data = new Float32Array(kept.length * 4 * size);
    kept.forEach((q, k) => {
      const base = q * 4;
      const centre = [0, 0, 0, 0];
      if (name === "position") for (let v = 0; v < 4; v++) for (let c = 0; c < 3; c++) centre[c] += component(attr, base + v, c) / 4;
      for (let v = 0; v < 4; v++)
        for (let c = 0; c < size; c++) {
          const value = component(attr, base + v, c);
          data[(k * 4 + v) * size + c] = name === "position" ? centre[c] + (value - centre[c]) * grow : value;
        }
    });
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const index = new Uint32Array(kept.length * 6);
  for (let k = 0; k < kept.length; k++) index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

function component(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, c: number): number {
  return c === 0 ? attr.getX(i) : c === 1 ? attr.getY(i) : c === 2 ? attr.getZ(i) : attr.getW(i);
}

export interface LodPlant {
  x: number;
  z: number;
  scale: number;
}

/** What a crown occupies, for culling: a sphere around its middle. */
export const CROWN_HEIGHT = 4;
export const CROWN_RADIUS = 6.5;

/**
 * Picks a level for each plant from its distance to the camera, or CULLED when it is
 * outside the view. `previous` makes a plant keep its level until it is clearly past
 * a threshold. Pure, so it is tested without WebGL.
 */
export function assignLods(
  plants: readonly LodPlant[],
  camera: { x: number; y: number; z: number },
  visible: (x: number, y: number, z: number, radius: number) => boolean,
  previous: Uint8Array | null,
  out: Uint8Array,
): void {
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i];
    if (!visible(p.x, CROWN_HEIGHT * p.scale, p.z, CROWN_RADIUS * p.scale + CULL_MARGIN)) {
      out[i] = CULLED;
      continue;
    }
    const dist = Math.hypot(p.x - camera.x, camera.y - CROWN_HEIGHT * p.scale, p.z - camera.z);
    const was = previous ? previous[i] : CULLED;
    const known = was !== CULLED;
    let level = 0;
    for (let t = 0; t < LOD_DISTANCE.length; t++) {
      const edge = LOD_DISTANCE[t];
      // A plant already past this edge stays coarse until it is clearly back inside;
      // one still finer waits until it is clearly past. A new one just compares.
      const coarse = known ? (was > t ? dist > edge - LOD_HYSTERESIS : dist > edge + LOD_HYSTERESIS) : dist > edge;
      if (coarse) level = t + 1;
    }
    out[i] = level;
  }
}
