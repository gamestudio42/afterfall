import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityMap } from "@afterfall/world";

function plane(x: number, z: number, w: number, d: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x + w / 2, y, z + d / 2);
  return g;
}

/** A flat strip along a center line, with round joints, for imported roads. */
function ribbon(path: { x: number; y: number }[], width: number, y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.05) continue;
    const g = new THREE.PlaneGeometry(len, width);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
    g.translate((a.x + b.x) / 2, y, (a.y + b.y) / 2);
    out.push(g);
  }
  for (const p of path) {
    const c = new THREE.CircleGeometry(width / 2, 12);
    c.rotateX(-Math.PI / 2);
    c.translate(p.x, y, p.y);
    out.push(c);
  }
  return out;
}

/** A flat filled outline (parks of imported maps). */
function flatPolygon(poly: { x: number; y: number }[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Static ground, roads, sidewalks, lane markings and parks. */
export function buildCityGround(city: CityMap): THREE.Group {
  const group = new THREE.Group();
  group.name = "ground";

  const margin = 400;
  const ground = new THREE.Mesh(
    plane(-margin, -margin, city.width + margin * 2, city.height + margin * 2, -0.05),
    new THREE.MeshStandardMaterial({ color: 0x4a4d40, roughness: 1 }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  // Blocks are slightly raised sidewalks.
  const pitch = city.blockSize + city.roadWidth;
  const blocks: THREE.BufferGeometry[] = [];
  for (let j = 0; j < city.blocksY; j++)
    for (let i = 0; i < city.blocksX; i++)
      blocks.push(plane(city.roadWidth + i * pitch, city.roadWidth + j * pitch, city.blockSize, city.blockSize, 0.06));
  if (blocks.length) {
    const blockMesh = new THREE.Mesh(mergeGeometries(blocks), new THREE.MeshStandardMaterial({ color: 0x8d897e, roughness: 0.95 }));
    blockMesh.receiveShadow = true;
    group.add(blockMesh);
  }

  const roads = city.roads.flatMap((r) => (r.path ? ribbon(r.path, r.width ?? 8, 0.01) : [plane(r.rect.x, r.rect.y, r.rect.w, r.rect.h, 0.01)]));
  const roadMesh = new THREE.Mesh(mergeGeometries(roads), new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.9 }));
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Dashed center lines, skipping intersections.
  const dashes: THREE.BufferGeometry[] = [];
  for (const r of city.roads) {
    if (r.path) continue;
    const len = r.horizontal ? r.rect.w : r.rect.h;
    for (let s = 0; s < len; s += 6) {
      const along = s;
      const inIntersection = along % pitch < city.roadWidth + 1 || along % pitch > pitch - 1;
      if (inIntersection) continue;
      if (r.horizontal) dashes.push(plane(r.rect.x + along, r.rect.y + r.rect.h / 2 - 0.1, 3, 0.2, 0.03));
      else dashes.push(plane(r.rect.x + r.rect.w / 2 - 0.1, r.rect.y + along, 0.2, 3, 0.03));
    }
  }
  if (dashes.length) group.add(new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshBasicMaterial({ color: 0x8c8a6e })));

  // Parks with trees.
  const parks = city.parks.map((p) => (p.polygon ? flatPolygon(p.polygon, 0.04) : plane(p.rect.x, p.rect.y, p.rect.w, p.rect.h, 0.08)));
  if (parks.length) {
    const parkMesh = new THREE.Mesh(mergeGeometries(parks), new THREE.MeshStandardMaterial({ color: 0x4d6b35, roughness: 1 }));
    parkMesh.receiveShadow = true;
    group.add(parkMesh);
  }
  const trees = city.parks.flatMap((p) => p.trees);
  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const crownGeo = new THREE.ConeGeometry(1.7, 4, 7);
    crownGeo.translate(0, 3.8, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4632 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3b5a2a, flatShading: true }), trees.length);
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const s = 0.8 + ((i * 37) % 10) / 20;
      m.makeScale(s, s, s).setPosition(t.x, 0, t.y);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    });
    trunks.castShadow = crowns.castShadow = true;
    group.add(trunks, crowns);
  }
  return group;
}
