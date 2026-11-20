import * as THREE from "three";
import { heightAt, type TerrainDef } from "@afterfall/world";

/**
 * Lays flat ground geometry (a lawn, a road ribbon, a quay) over the terrain: every
 * triangle is split until no edge is longer than `maxEdge`, then every vertex is raised to
 * the ground under it. The split is what lets a 300 m park follow a hillside instead of
 * floating over it as one plane between its corners.
 *
 * Returns the geometry unchanged on a flat map.
 */
export function drape(geo: THREE.BufferGeometry, terrain: TerrainDef | undefined, maxEdge = terrain?.cell ?? 4): THREE.BufferGeometry {
  if (!terrain) return geo;
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute("position");
  const nrm = src.getAttribute("normal");
  const uv = src.getAttribute("uv");
  const extra = Object.keys(src.attributes).filter((k) => k !== "position" && k !== "normal" && k !== "uv");
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outUv: number[] = [];
  const outExtra: Record<string, number[]> = Object.fromEntries(extra.map((k) => [k, []]));
  type V = { p: number[]; n: number[]; t: number[]; e: number[][] };
  const read = (i: number): V => ({
    p: [pos.getX(i), pos.getY(i), pos.getZ(i)],
    n: nrm ? [nrm.getX(i), nrm.getY(i), nrm.getZ(i)] : [0, 1, 0],
    t: uv ? [uv.getX(i), uv.getY(i)] : [0, 0],
    e: extra.map((k) => {
      const a = src.getAttribute(k);
      return Array.from({ length: a.itemSize }, (_, c) => a.getComponent(i, c));
    }),
  });
  const mid = (a: V, b: V): V => ({
    p: a.p.map((v, k) => (v + b.p[k]) / 2),
    n: a.n.map((v, k) => (v + b.n[k]) / 2),
    t: a.t.map((v, k) => (v + b.t[k]) / 2),
    e: a.e.map((arr, j) => arr.map((v, k) => (v + b.e[j][k]) / 2)),
  });
  const len2 = (a: V, b: V) => (a.p[0] - b.p[0]) ** 2 + (a.p[2] - b.p[2]) ** 2;
  const max2 = maxEdge * maxEdge;
  const emit = (v: V) => {
    outPos.push(v.p[0], v.p[1] + heightAt(terrain, v.p[0], v.p[2]), v.p[2]);
    outNrm.push(...v.n);
    outUv.push(...v.t);
    extra.forEach((k, j) => outExtra[k].push(...v.e[j]));
  };
  const split = (a: V, b: V, c: V, depth: number): void => {
    const ab = len2(a, b);
    const bc = len2(b, c);
    const ca = len2(c, a);
    const worst = Math.max(ab, bc, ca);
    if (worst <= max2 || depth > 14) {
      emit(a);
      emit(b);
      emit(c);
      return;
    }
    // Split the longest edge: the halves keep the winding of the parent.
    if (worst === ab) {
      const m = mid(a, b);
      split(a, m, c, depth + 1);
      split(m, b, c, depth + 1);
    } else if (worst === bc) {
      const m = mid(b, c);
      split(a, b, m, depth + 1);
      split(a, m, c, depth + 1);
    } else {
      const m = mid(c, a);
      split(a, b, m, depth + 1);
      split(m, b, c, depth + 1);
    }
  };
  for (let i = 0; i < pos.count; i += 3) split(read(i), read(i + 1), read(i + 2), 0);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  if (nrm) out.setAttribute("normal", new THREE.Float32BufferAttribute(outNrm, 3));
  if (uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(outUv, 2));
  for (const k of extra) out.setAttribute(k, new THREE.Float32BufferAttribute(outExtra[k], src.getAttribute(k).itemSize));
  // Flat pieces facing up take the slope's normal, so a hillside is lit like one.
  if (nrm) {
    const n = out.getAttribute("normal") as THREE.BufferAttribute;
    const e = terrain.cell;
    for (let i = 0; i < n.count; i++) {
      if (n.getY(i) < 0.9) continue;
      const x = outPos[i * 3];
      const z = outPos[i * 3 + 2];
      const dx = heightAt(terrain, x + e, z) - heightAt(terrain, x - e, z);
      const dz = heightAt(terrain, x, z + e) - heightAt(terrain, x, z - e);
      const v = new THREE.Vector3(-dx, 2 * e, -dz).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
  }
  out.computeBoundingSphere();
  return out;
}

/**
 * The base ground as a grid that follows the relief, out past the map's edge (where the
 * height is the edge's own, held flat). On a flat map, one quad, as before.
 */
export function groundGrid(x0: number, z0: number, w: number, d: number, y: number, terrain: TerrainDef | undefined): THREE.BufferGeometry {
  const step = terrain ? terrain.cell : Math.max(w, d);
  const sx = Math.max(1, Math.round(w / step));
  const sz = Math.max(1, Math.round(d / step));
  const g = new THREE.PlaneGeometry(w, d, sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate(x0 + w / 2, y, z0 + d / 2);
  if (!terrain) return g;
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setY(i, y + heightAt(terrain, p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/**
 * Where a ray from the camera meets the ground. On a flat map, the plane at height 0; on a
 * hillside, a march along the ray from the height of the highest ground down, refined by
 * bisection once it passes under the surface.
 */
export function rayGround(origin: THREE.Vector3, dir: THREE.Vector3, terrain: TerrainDef | undefined, top: number): THREE.Vector3 | null {
  if (!terrain) {
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = -origin.y / dir.y;
    return t < 0 ? null : origin.clone().addScaledVector(dir, t);
  }
  if (dir.y > -1e-6) return null;
  // Start where the ray comes down through the highest ground, or at the camera.
  let t = Math.max(0, (origin.y - top) / -dir.y);
  const above = (s: number) => {
    const x = origin.x + dir.x * s;
    const z = origin.z + dir.z * s;
    return origin.y + dir.y * s - heightAt(terrain, x, z);
  };
  const step = terrain.cell * 0.5;
  let prev = t;
  for (let i = 0; i < 4000; i++) {
    if (above(t) <= 0) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const m = (lo + hi) / 2;
        if (above(m) > 0) lo = m;
        else hi = m;
      }
      return origin.clone().addScaledVector(dir, hi);
    }
    prev = t;
    t += step;
  }
  return null;
}

/** The highest drawn ground on the map, for picking and the shadow box. */
export function terrainTop(terrain: TerrainDef | undefined): number {
  if (!terrain) return 0;
  let max = 0;
  for (const h of terrain.heights) max = Math.max(max, h);
  return (max / 10) * terrain.scale;
}

/** The ground's normal at a point, from its heights `reach` metres either side. Up on a flat map. */
export function groundNormal(terrain: TerrainDef | undefined, x: number, z: number, reach: number): [number, number, number] {
  const dx = heightAt(terrain, x + reach, z) - heightAt(terrain, x - reach, z);
  const dz = heightAt(terrain, x, z + reach) - heightAt(terrain, x, z - reach);
  const l = Math.hypot(dx, 2 * reach, dz);
  return [-dx / l, (2 * reach) / l, -dz / l];
}
