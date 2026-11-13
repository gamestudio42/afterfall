import * as THREE from "three";
import type { CityMap } from "@afterfall/world";
import { deriveSeed } from "@afterfall/shared";
import { growthAt, hash2, inBuilding, onRoad, type ReclamationField } from "./reclamation";

/** One clump of tall grass and weeds. */
export interface Tuft {
  x: number;
  z: number;
  /** Height in metres. */
  height: number;
  yaw: number;
  /** 0 green, 1 straw. */
  dry: number;
  shade: number;
}

/** Instances at most: 80 k triangles, alpha-tested. */
export const GRASS_CAP = 10000;
/** Spacing of the scatter grid, in metres. */
const STEP = 1.35;
/** Doors stay clear, so an entrance reads from the RTS camera and a click finds it. */
const DOOR_CLEAR = 2.8;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tall grass where the reclamation field says growth has taken: thick against walls
 * and park edges, a fringe in the gutter, none in the middle of the carriageway. It is
 * cosmetic: it never blocks movement or building, and stays below a survivor's waist.
 */
export function placeGrass(city: CityMap, field: ReclamationField, density = 1): Tuft[] {
  const out: Tuft[] = [];
  const seed = deriveSeed(city.seed >>> 0, "grass");
  const doors = city.buildings.map((b) => b.entrance);
  const nearDoor = (x: number, z: number) => doors.some((d) => Math.abs(d.x - x) < DOOR_CLEAR && Math.abs(d.y - z) < DOOR_CLEAR);
  const cols = Math.ceil(city.width / STEP),
    rows = Math.ceil(city.height / STEP);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = (c + hash2(c, r, seed)) * STEP;
      const z = (r + hash2(c, r, seed + 1)) * STEP;
      const g = growthAt(field, x, z);
      const road = onRoad(field, x, z);
      // Asphalt only gives way at its edges, so tufts there need a stronger field.
      const chance = road ? smooth(0.58, 0.9, g) * 0.7 : smooth(0.5, 0.85, g) * 0.92;
      if (hash2(c, r, seed + 2) >= chance * density) continue;
      if (inBuilding(field, x, z) || inBuilding(field, x + 0.5, z) || inBuilding(field, x - 0.5, z)) continue;
      if (inBuilding(field, x, z + 0.5) || inBuilding(field, x, z - 0.5) || nearDoor(x, z)) continue;
      const h = hash2(c, r, seed + 3);
      out.push({
        x,
        z,
        height: (0.3 + 0.7 * h) * (0.55 + 0.5 * g) * (road ? 0.7 : 1),
        yaw: hash2(c, r, seed + 4) * Math.PI,
        dry: 0.75 * smooth(0.3, 0.8, hash2(Math.floor(c / 6), Math.floor(r / 6), seed + 5) * 0.7 + h * 0.3),
        shade: 0.78 + hash2(c, r, seed + 6) * 0.3,
      });
    }
  // Over budget, thin evenly: stopping the scan at the cap left the far rows bare.
  if (out.length <= GRASS_CAP) return out;
  const keep = GRASS_CAP / out.length;
  const thinned = out.filter((t, i) => hash2(i, 7, seed) < keep);
  return thinned.length > GRASS_CAP ? thinned.slice(0, GRASS_CAP) : thinned;
}

/** Blades as an alpha mask (green channel): tapered, leaning, of uneven height. */
function bladeMask(): THREE.DataTexture {
  const W = 64,
    H = 64;
  const data = new Uint8Array(W * H * 4);
  let s = 7;
  const rand = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let b = 0; b < 26; b++) {
    // A tuft springs from its middle and fans out. Bases spread over the whole card left
    // an almost solid bottom row, which the mipmaps turned into a dark stroke along the
    // foot of every card at close zoom.
    const base = W / 2 + (rand() - 0.5) * W * 0.4;
    const lean = (base - W / 2) * 1.1 + (rand() - 0.5) * 18;
    const top = 0.45 + rand() * 0.55;
    const width = 2.2 + rand() * 2.2;
    // The bottom rows stay clear (the root sits in the ground): at a distance the mipmaps
    // still average them into a solid stroke.
    for (let y = 6; y < H; y++) {
      const v = y / (H - 1);
      if (v > top) break;
      const k = v / top;
      const cx = base + lean * k * k;
      const half = width * (1 - k * 0.92);
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
        if (x < 0 || x >= W || Math.abs(x - cx) > half) continue;
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Four cards splayed outward from the root like an opened fan, dark at the foot.
 * Upright crossed cards read from the RTS camera as thin dark crosses; tilted ones
 * show their face to a camera looking down and read as a clump.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const parts: number[] = [],
    uvs: number[] = [],
    colors: number[] = [],
    index: number[] = [];
  const TILT = 0.75; // radians from vertical
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4;
    const ox = Math.cos(a),
      oz = Math.sin(a);
    // Card spans sideways (perpendicular to its lean), leans outward along (ox, oz).
    const sx = -oz * 0.5,
      sz = ox * 0.5;
    const tx = ox * Math.sin(TILT),
      ty = Math.cos(TILT),
      tz = oz * Math.sin(TILT);
    const o = parts.length / 3;
    parts.push(-sx, 0, -sz, sx, 0, sz, sx + tx, ty, sz + tz, -sx + tx, ty, -sz + tz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    colors.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92);
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(parts, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // Normals point up: lit like the ground under them instead of flashing as the cards turn.
  const normals = new Float32Array(parts.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** The tall-grass layer: one instanced draw, swaying with the same wind as the trees. */
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly wind = { value: 0 };
  private readonly mask: THREE.DataTexture;
  /** `density` below 1 thins the layer, for software rasterisers where overdraw is the frame. */
  constructor(city: CityMap, field: ReclamationField, density = 1) {
    const tufts = placeGrass(city, field, density);
    this.mask = bladeMask();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
      alphaMap: this.mask,
      alphaTest: 0.45,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.grassTime = this.wind;
      shader.vertexShader = "uniform float grassTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 tuftRoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sway = sin(grassTime * 1.7 + tuftRoot.x * 0.35 + tuftRoot.z * 0.25) * 0.6
          + sin(grassTime * 3.1 + tuftRoot.z * 0.9) * 0.25;
        transformed.x += sway * position.y * position.y * 0.12;`,
      );
    };
    material.customProgramCacheKey = () => "reclaim-grass-v1";
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, Math.max(1, tufts.length));
    this.mesh.name = "reclaim-grass";
    this.mesh.count = tufts.length;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      v = new THREE.Vector3(),
      s = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      color = new THREE.Color();
    const green = new THREE.Color(0x56652b),
      straw = new THREE.Color(0x8a7c48);
    tufts.forEach((t, i) => {
      const width = 0.9 + t.height * 0.8;
      m.compose(v.set(t.x, -0.03, t.z), q.setFromAxisAngle(up, t.yaw), s.set(width, t.height, width));
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, color.copy(green).lerp(straw, t.dry).multiplyScalar(t.shade));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(time: number): void {
    this.wind.value = time;
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mask.dispose();
    this.mesh.dispose();
  }
}
