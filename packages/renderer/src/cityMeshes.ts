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

/**
 * The sidewalk of an imported road, as two strips beside it instead of one wide strip
 * under it. A strip under the road shares its plane within a few millimetres, and at a
 * distance the depth buffer cannot separate them: the light ribbon striped through the
 * asphalt and shimmered as the camera moved (playtest video). Removing the overlap makes
 * the question moot, whatever the camera distance.
 */
export function sidewalk(path: { x: number; y: number }[], roadWidth: number, width: number, y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.05) continue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (const side of [-1, 1]) {
      const off = side * (roadWidth / 2 + width / 2);
      const g = new THREE.PlaneGeometry(len + width, width);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(b.y - a.y, b.x - a.x));
      g.translate((a.x + b.x) / 2 + nx * off, y, (a.y + b.y) / 2 + ny * off);
      out.push(g);
    }
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

/**
 * Colour each ground material takes once its map arrives. Three multiplies the
 * colour by the map, so keeping the flat colour darkened everything twice: the
 * asphalt landed at sRGB 10 instead of 52 and the roads read as black holes.
 * Each tint is the flat colour divided by the map's mean (in linear light), so
 * a textured surface averages out to the colour it had before. A tint can only
 * darken, so the ground's blue stays at the grass map's own (45 against 64) and
 * the bare ground reads a little more yellow; the parks keep white because the
 * grass map is already the park's green.
 */
/**
 * The base of an imported map: worn ground, clearly darker than the sidewalk that runs
 * along each street. It started at the sidewalk's own lightness, which made every open
 * lot read as pavement — buildings looked like they had been built on the road.
 */
export const URBAN_GROUND_TINT = 0x77736b;

export const TEXTURED_TINT: Record<keyof GroundMaterials, number> = {
  roads: 0xa2a5aa,
  ground: 0xd8c3ff,
  // Blocks wear the sidewalk slabs (mean sRGB 170, 169, 165).
  blocks: 0xd5d0c4,
  // Curbs wear the concrete map and stay a step lighter than the sidewalk.
  curbs: 0xf8f9f8,
  parks: 0xffffff,
};

/** The sidewalk map is one 3.2 m module of 0.8 m slabs. */
export const SIDEWALK_TILE = 3.2;
/** How far a sidewalk reaches past the road edge on imported maps. */
export const SIDEWALK_WIDTH = 2.6;

/** A second, larger sample breaks up obvious repetition across broad surfaces. */
function layeredSurface(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      #ifdef USE_MAP
        vec2 broadUv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.173 + vec2(0.37, 0.61);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(map, broadUv).rgb, 0.38);
      #endif`,
    );
  };
  material.customProgramCacheKey = () => "layered-ground-v1";
}
/** Curb: a low lip at the block edge, low enough that feet do not sink in it. */
const CURB_W = 0.3;
const CURB_H = 0.12;

/** Materials the ground is built from, so the art pass can give each a map. */
export interface GroundMaterials {
  ground: THREE.MeshStandardMaterial;
  blocks: THREE.MeshStandardMaterial | null;
  curbs: THREE.MeshStandardMaterial | null;
  roads: THREE.MeshStandardMaterial | null;
  parks: THREE.MeshStandardMaterial | null;
}

/**
 * A curb around a block: a strip on top and the face down to the road, on all
 * four sides. Top at CURB_H, so the block's sidewalk (at 0.06) sits a little
 * below it, which is what makes the edge read from the RTS camera.
 */
export function curbRing(x: number, z: number, w: number, d: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const top = (x0: number, z0: number, ww: number, dd: number) => out.push(plane(x0, z0, ww, dd, CURB_H));
  top(x, z, w, CURB_W);
  top(x, z + d - CURB_W, w, CURB_W);
  top(x, z + CURB_W, CURB_W, d - CURB_W * 2);
  top(x + w - CURB_W, z + CURB_W, CURB_W, d - CURB_W * 2);
  // Outer faces, facing the road.
  const face = (cx: number, cz: number, len: number, rotY: number) => {
    const g = new THREE.PlaneGeometry(len, CURB_H);
    g.rotateY(rotY);
    g.translate(cx, CURB_H / 2, cz);
    out.push(g);
  };
  face(x + w / 2, z, w, Math.PI);
  face(x + w / 2, z + d, w, 0);
  face(x, z + d / 2, d, -Math.PI / 2);
  face(x + w, z + d / 2, d, Math.PI / 2);
  return out;
}

/**
 * Replaces planar UVs with world-space ones, so one tileable texture repeats
 * every `tile` metres across a merged mesh of many differently sized quads.
 */
function worldUv(geo: THREE.BufferGeometry, tile: number): void {
  const pos = geo.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * Static ground, roads, sidewalks, lane markings and parks.
 *
 * A generated city is blocks with a sidewalk each and grass between them; an imported
 * one has streets and buildings and nothing else, so its base has to be paved — painting
 * it grass turned a dense neighbourhood into a lawn with buildings standing on it.
 */
export function buildCityGround(city: CityMap): {
  group: THREE.Group;
  materials: GroundMaterials;
  /** True for an imported map: streets and footprints, no blocks. */
  imported: boolean;
} {
  const group = new THREE.Group();
  group.name = "ground";

  const imported = city.blocksX === 0 || city.blockSize <= 0;
  const margin = 400;
  const groundMat = new THREE.MeshStandardMaterial({ color: imported ? 0x6f6d66 : 0x4a4d40, roughness: 1 });
  layeredSurface(groundMat);
  const materials: GroundMaterials = { ground: groundMat, blocks: null, curbs: null, roads: null, parks: null };
  const groundGeo = plane(-margin, -margin, city.width + margin * 2, city.height + margin * 2, -0.05);
  worldUv(groundGeo, 12);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // Blocks are slightly raised sidewalks.
  const pitch = city.blockSize + city.roadWidth;
  const blocks: THREE.BufferGeometry[] = [];
  for (let j = 0; j < city.blocksY; j++)
    for (let i = 0; i < city.blocksX; i++)
      blocks.push(plane(city.roadWidth + i * pitch, city.roadWidth + j * pitch, city.blockSize, city.blockSize, 0.06));
  // Imported maps have no blocks: their sidewalks run along the roads instead,
  // a ribbon wider than the road laid just under it.
  // Imported maps: the sidewalk is a ribbon wider than the road, laid just under it.
  // The gap is deliberately generous — at five millimetres the two surfaces fought in the
  // depth buffer at distance and the ribbon striped through the asphalt (playtest video).
  for (const r of city.roads) if (r.path) blocks.push(...sidewalk(r.path, r.width ?? 8, SIDEWALK_WIDTH, 0.02));
  if (blocks.length) {
    const blockGeo = mergeGeometries(blocks.map((g) => (g.index ? g.toNonIndexed() : g)));
    worldUv(blockGeo, SIDEWALK_TILE);
    materials.blocks = new THREE.MeshStandardMaterial({ color: 0x8d897e, roughness: 0.95 });
    const blockMesh = new THREE.Mesh(blockGeo, materials.blocks);
    blockMesh.receiveShadow = true;
    group.add(blockMesh);
  }

  // Curbs around the blocks of a generated city.
  const curbs: THREE.BufferGeometry[] = [];
  for (let j = 0; j < city.blocksY; j++)
    for (let i = 0; i < city.blocksX; i++)
      curbs.push(...curbRing(city.roadWidth + i * pitch, city.roadWidth + j * pitch, city.blockSize, city.blockSize));
  if (curbs.length) {
    const curbGeo = mergeGeometries(curbs);
    worldUv(curbGeo, 3);
    materials.curbs = new THREE.MeshStandardMaterial({ color: 0xb3afa5, roughness: 0.9 });
    const curbMesh = new THREE.Mesh(curbGeo, materials.curbs);
    curbMesh.receiveShadow = true;
    group.add(curbMesh);
  }

  const roads = city.roads.flatMap((r) =>
    r.path ? ribbon(r.path, r.width ?? 8, 0.03) : [plane(r.rect.x, r.rect.y, r.rect.w, r.rect.h, 0.03)],
  );
  // A map with no roads at all (a fixture, or a save from one) used to crash here:
  // `mergeGeometries([])` reads `geometries[0].index` without checking.
  if (roads.length) {
    const roadGeo = mergeGeometries(roads);
    worldUv(roadGeo, 6);
    materials.roads = new THREE.MeshStandardMaterial({
      color: 0x34363a,
      roughness: 0.9,
      // The asphalt sits a centimetre or two above whatever is under it (a sidewalk
      // ribbon, a park edge); a depth bias makes it win even at the far end of the map.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const roadMesh = new THREE.Mesh(roadGeo, materials.roads);
    layeredSurface(materials.roads);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);
  }

  // Dashed center lines, skipping intersections.
  const dashes: THREE.BufferGeometry[] = [];
  for (const r of city.roads) {
    if (r.path) continue;
    const len = r.horizontal ? r.rect.w : r.rect.h;
    for (let s = 0; s < len; s += 6) {
      const along = s;
      const inIntersection = along % pitch < city.roadWidth + 6 || along % pitch > pitch - 8;
      if (inIntersection) continue;
      if (r.horizontal) dashes.push(plane(r.rect.x + along, r.rect.y + r.rect.h / 2 - 0.1, 3, 0.2, 0.05));
      else dashes.push(plane(r.rect.x + r.rect.w / 2 - 0.1, r.rect.y + along, 0.2, 3, 0.05));
    }
  }
  // Short zebra crossings anchor the street scale, leaving the junction itself open.
  if (!imported) {
    const half = city.roadWidth / 2;
    for (const p of city.intersections) {
      for (const side of [-1, 1]) {
        const along = side * (half + 3);
        for (let across = -half + 1.2; across < half - 1.2; across += 1.35) {
          if (p.x + along > 2 && p.x + along < city.width - 2) dashes.push(plane(p.x + along - 1.25, p.y + across, 2.5, 0.65, 0.05));
          if (p.y + along > 2 && p.y + along < city.height - 2) dashes.push(plane(p.x + across, p.y + along - 1.25, 0.65, 2.5, 0.05));
        }
      }
    }
  }
  if (dashes.length) {
    const paint = new THREE.MeshStandardMaterial({
      color: 0x9c9581,
      roughness: 1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    // Irregular chips in paint, computed in world space so neighbouring stripes differ.
    paint.onBeforeCompile = (shader) => {
      shader.vertexShader = "varying vec3 paintPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\npaintPosition = position;");
      shader.fragmentShader =
        `varying vec3 paintPosition;
        float paintNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)),
            dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)),
            dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)),
            dot(i + vec2(1.0), vec2(127.1, 311.7)))) * 43758.5453);
          return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
        }\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        `
        float wear = mix(paintNoise(paintPosition.xz * 5.0), paintNoise(paintPosition.xz * 18.0), 0.22);
        diffuseColor.a *= (1.0 - smoothstep(0.56, 0.72, wear)) * 0.72;
        #include <alphatest_fragment>`,
      );
    };
    paint.customProgramCacheKey = () => "worn-road-paint-v1";
    const mesh = new THREE.Mesh(mergeGeometries(dashes), paint);
    mesh.receiveShadow = true;
    mesh.name = "street-markings";
    group.add(mesh);
  }

  // Parks with trees.
  const parks = city.parks.map((p) => (p.polygon ? flatPolygon(p.polygon, 0.04) : plane(p.rect.x, p.rect.y, p.rect.w, p.rect.h, 0.08)));
  if (parks.length) {
    const parkGeo = mergeGeometries(parks);
    worldUv(parkGeo, 8);
    materials.parks = new THREE.MeshStandardMaterial({ color: 0x4d6b35, roughness: 1 });
    layeredSurface(materials.parks);
    const parkMesh = new THREE.Mesh(parkGeo, materials.parks);
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
    const fallback = new THREE.Group();
    fallback.name = "park-tree-fallback";
    fallback.add(trunks, crowns);
    group.add(fallback);
  }
  return { group, materials, imported };
}
