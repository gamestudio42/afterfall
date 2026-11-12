import * as THREE from "three";
import type { BuildingDef } from "@afterfall/world";
import { holesOf, inflate, outlineOf } from "./buildingBatch";

/** How far the darkening reaches from a wall, and how dark it is at the wall. */
export const CONTACT_REACH = 2.6;
export const CONTACT_STRENGTH = 0.5;
/** Above the sidewalk (0.06) and the road markings (0.05), below the kerb top. */
const CONTACT_Y = 0.085;

/**
 * Ambient occlusion where it matters most from an RTS camera: the ground at
 * the foot of every wall. A building blocks half the sky from the pavement
 * beside it, and without that darkening the blocks looked set down on the
 * ground rather than standing in it.
 *
 * It is geometry, not a screen-space pass: a skirt around each outline (and
 * inside each courtyard) that fades from dark at the wall to nothing a few
 * metres out. One draw call for the city, no depth or normal buffer, and the
 * same picture on a software rasteriser as on a GPU.
 */
export function buildContactShadows(buildings: BuildingDef[]): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const skirt = (poly: { x: number; y: number }[], reach: number) => {
    if (poly.length < 3) return;
    const outer = inflate(poly, reach);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const quad: [{ x: number; y: number }, number][] = [
        [poly[i], CONTACT_STRENGTH],
        [poly[j], CONTACT_STRENGTH],
        [outer[j], 0],
        [poly[i], CONTACT_STRENGTH],
        [outer[j], 0],
        [outer[i], 0],
      ];
      for (const [p, a] of quad) {
        pos.push(p.x, CONTACT_Y, p.y);
        col.push(0, 0, 0, a);
      }
    }
  };
  for (const b of buildings) {
    // Taller buildings hide more sky, so their shade reaches a little farther.
    const reach = CONTACT_REACH * Math.min(1.6, 0.7 + b.height / 30);
    skirt(outlineOf(b), reach);
    // A courtyard is open air walled on every side: it darkens inward.
    for (const hole of holesOf(b)) skirt(hole, -Math.min(reach, 1.6));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "contact-shadows";
  mesh.renderOrder = 1;
  return mesh;
}
