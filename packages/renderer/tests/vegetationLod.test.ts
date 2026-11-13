import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assignLods, CULL_MARGIN, CULLED, decimateQuads, LEAF_KEEP, LOD_DISTANCE, LOD_HYSTERESIS } from "../src/vegetationLod";

/** A mesh of `n` leaf cards, one metre each, laid out along x, as the kit exports them. */
function cards(n: number): THREE.BufferGeometry {
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let q = 0; q < n; q++) {
    position.push(q * 2, 0, 0, q * 2 + 1, 0, 0, q * 2 + 1, 1, 0, q * 2, 1, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

describe("leaf card decimation", () => {
  it("keeps about the share asked for, as whole quads, and is deterministic", () => {
    const g = cards(1778);
    for (const keep of LEAF_KEEP.slice(1)) {
      const d = decimateQuads(g, keep);
      const quads = d.getAttribute("position").count / 4;
      expect(quads).toBeGreaterThan(1778 * keep * 0.85);
      expect(quads).toBeLessThan(1778 * keep * 1.15);
      expect(d.index!.count).toBe(quads * 6);
      expect(Array.from(d.getAttribute("uv").array)).toEqual(Array.from(decimateQuads(g, keep).getAttribute("uv").array));
    }
  });

  it("grows each survivor about its own centre so the crown keeps its cover", () => {
    const g = cards(400);
    const d = decimateQuads(g, 0.14);
    const p = d.getAttribute("position");
    const area = (q: number) => {
      const w = p.getX(q * 4 + 1) - p.getX(q * 4);
      const h = p.getY(q * 4 + 2) - p.getY(q * 4);
      return w * h;
    };
    const total = Array.from({ length: p.count / 4 }, (_, q) => area(q)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(400 * 0.55);
    expect(total).toBeLessThan(400 * 1.1);
    // A survivor is centred where it was: card q was centred at x = 2q + 0.5.
    expect(((p.getX(0) + p.getX(1)) / 2) % 2).toBeCloseTo(0.5, 5);
  });

  it("level 0 is the model untouched", () => {
    expect(decimateQuads(cards(10), 1).getAttribute("position").count).toBe(40);
  });
});

describe("level selection", () => {
  const all = () => true;
  const camera = { x: 0, y: 40, z: 0 };
  const at = (d: number) => ({ x: d, z: 0, scale: 1 });
  const dist = (d: number) => Math.hypot(d, 40 - 4);

  it("gets coarser with distance", () => {
    const out = new Uint8Array(3);
    // Distances chosen from the thresholds, taking the camera height into account.
    const near = Math.sqrt(60 ** 2 - 36 ** 2);
    const mid = Math.sqrt(120 ** 2 - 36 ** 2);
    const far = Math.sqrt(220 ** 2 - 36 ** 2);
    assignLods([at(near), at(mid), at(far)], camera, all, null, out);
    expect(Array.from(out)).toEqual([0, 1, 2]);
    expect(dist(near)).toBeLessThan(LOD_DISTANCE[0]);
  });

  it("does not flicker at a threshold, and still changes once clearly past it", () => {
    const edge = LOD_DISTANCE[0];
    const x = (d: number) => Math.sqrt(d * d - 36 * 36);
    const out = new Uint8Array(1);
    const prev = new Uint8Array([0]);
    assignLods([at(x(edge + LOD_HYSTERESIS / 2))], camera, all, prev, out);
    expect(out[0]).toBe(0);
    assignLods([at(x(edge + LOD_HYSTERESIS * 2))], camera, all, prev, out);
    expect(out[0]).toBe(1);
    const coarse = new Uint8Array([1]);
    assignLods([at(x(edge - LOD_HYSTERESIS / 2))], camera, all, coarse, out);
    expect(out[0]).toBe(1);
    assignLods([at(x(edge - LOD_HYSTERESIS * 2))], camera, all, coarse, out);
    expect(out[0]).toBe(0);
  });

  it("culls what is outside the view and gives the test a margin for shadows", () => {
    const out = new Uint8Array(2);
    const radii: number[] = [];
    assignLods([at(10), at(20)], camera, (x, _y, _z, r) => (radii.push(r), x < 15), null, out);
    expect(Array.from(out)).toEqual([0, CULLED]);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(CULL_MARGIN);
  });
});
