import * as THREE from "three";
import type { CityMap } from "@afterfall/world";
import { deriveSeed, pointInPolygon } from "@afterfall/shared";

/**
 * How far nature has taken back each square metre of the city, years after the
 * outbreak. One field drives both the ground shaders (soil and moss over paving)
 * and the scatter of grass and street trees, so a tuft never stands on clean
 * concrete and a green patch never lies bare.
 *
 * The value follows where growth starts in an abandoned city: against walls,
 * in the gutter and at the curb, around parks that have spilled over their
 * edges, and in broad patches where seed happened to land. The middle of a
 * carriageway stays the clearest surface, which keeps the streets readable
 * from the RTS camera.
 */
export interface ReclamationField {
  /** World x and z of texel (0, 0)'s corner. */
  x0: number;
  z0: number;
  /** Metres per texel. */
  cell: number;
  cols: number;
  rows: number;
  /** Overgrowth, 0 (clean) to 1 (taken back). */
  growth: Float32Array;
  /** Slow regional variation, 0 to 1: how worn one stretch of paving is against the next. */
  wear: Float32Array;
  /** 1 on a carriageway, 0 elsewhere. */
  road: Uint8Array;
  /** 1 inside a building footprint (its bounding rectangle). */
  building: Uint8Array;
}

/** Texels per side at most; a generated city fits at one metre a texel. */
const MAX_TEXELS = 512;
/** Margin past the map edge, so the ground under the outskirts is covered too. */
const MARGIN = 24;

export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  let fx = x - ix,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed),
    b = hash2(ix + 1, iz, seed),
    c = hash2(ix, iz + 1, seed),
    d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Three octaves, 0 to 1, features about `1 / freq` metres wide. */
function fbm(x: number, z: number, freq: number, seed: number): number {
  return (
    valueNoise(x * freq, z * freq, seed) * 0.55 +
    valueNoise(x * freq * 2.03, z * freq * 2.03, seed + 17) * 0.3 +
    valueNoise(x * freq * 4.11, z * freq * 4.11, seed + 31) * 0.15
  );
}

/**
 * Two-pass chamfer distance transform, in cells: 0 inside the mask, growing away
 * from it. Cheap enough for half a megapixel on a phone, unlike a search per texel.
 */
export function distanceField(mask: Uint8Array, cols: number, rows: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + 1);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + 1);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + D);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + D);
      }
      d[i] = v;
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + 1);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + 1);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + D);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + D);
      }
      d[i] = v;
    }
  return d;
}

export function buildReclamation(city: CityMap): ReclamationField {
  const x0 = -MARGIN,
    z0 = -MARGIN;
  const span = Math.max(city.width, city.height) + MARGIN * 2;
  const cell = Math.max(1, span / MAX_TEXELS);
  const cols = Math.ceil((city.width + MARGIN * 2) / cell);
  const rows = Math.ceil((city.height + MARGIN * 2) / cell);
  const n = cols * rows;
  const road = new Uint8Array(n);
  const building = new Uint8Array(n);
  const park = new Uint8Array(n);
  const seed = deriveSeed(city.seed >>> 0, "reclamation");

  const cx = (c: number) => x0 + (c + 0.5) * cell;
  const cz = (r: number) => z0 + (r + 0.5) * cell;
  const span2 = (a: number, b: number, origin: number, limit: number) => [
    Math.max(0, Math.floor((a - origin) / cell)),
    Math.min(limit - 1, Math.floor((b - origin) / cell)),
  ];
  const fillRect = (mask: Uint8Array, x: number, z: number, w: number, h: number, test?: (px: number, pz: number) => boolean) => {
    const [c0, c1] = span2(x, x + w, x0, cols);
    const [r0, r1] = span2(z, z + h, z0, rows);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const px = cx(c),
          pz = cz(r);
        if (px < x || px > x + w || pz < z || pz > z + h) continue;
        if (!test || test(px, pz)) mask[r * cols + c] = 1;
      }
  };

  for (const b of city.buildings) fillRect(building, b.rect.x, b.rect.y, b.rect.w, b.rect.h);
  for (const p of city.parks)
    fillRect(park, p.rect.x, p.rect.y, p.rect.w, p.rect.h, p.polygon ? (x, z) => pointInPolygon(x, z, p.polygon!) : undefined);
  for (const rd of city.roads) {
    if (!rd.path) {
      fillRect(road, rd.rect.x, rd.rect.y, rd.rect.w, rd.rect.h);
      continue;
    }
    const half = (rd.width ?? 8) / 2;
    for (let i = 1; i < rd.path.length; i++) {
      const a = rd.path[i - 1],
        b = rd.path[i];
      const dx = b.x - a.x,
        dz = b.y - a.y;
      const len2 = dx * dx + dz * dz || 1;
      fillRect(road, Math.min(a.x, b.x) - half, Math.min(a.y, b.y) - half, Math.abs(dx) + half * 2, Math.abs(dz) + half * 2, (px, pz) => {
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.y) * dz) / len2));
        return Math.hypot(px - a.x - dx * t, pz - a.y - dz * t) <= half;
      });
    }
  }

  const toBuilding = distanceField(building, cols, rows);
  const toRoad = distanceField(road, cols, rows);
  const offRoad = new Uint8Array(n);
  for (let i = 0; i < n; i++) offRoad[i] = road[i] ? 0 : 1;
  const intoRoad = distanceField(offRoad, cols, rows);
  const toPark = distanceField(park, cols, rows);

  const growth = new Float32Array(n);
  const wear = new Float32Array(n);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = cx(c),
        z = cz(r);
      // Where seed happened to land and take: broad patches with ragged edges.
      const patch = fbm(x, z, 1 / 22, seed);
      let g = 0.2 + Math.max(0, patch - 0.33) * 1.5;
      // Against walls: rain off the roof, shade, and the corner where litter gathers.
      g += 0.5 * Math.exp(-(toBuilding[i] * cell) / 2.2);
      // Parks have spilled over their edges.
      g += park[i] ? 0.85 : 0.55 * Math.exp(-(toPark[i] * cell) / 9);
      if (road[i]) {
        // Asphalt holds out longest in the middle; the gutter fills first.
        const fromEdge = intoRoad[i] * cell;
        g = g * 0.4 + 0.5 * Math.exp(-fromEdge / 1.1) + Math.max(0, fbm(x, z, 1 / 4, seed + 5) - 0.62) * 0.9;
      } else {
        // Weeds come up first along the curb and in the joints beside it.
        g += 0.22 * Math.exp(-(toRoad[i] * cell) / 1.4);
      }
      growth[i] = Math.max(0, Math.min(1, g));
      wear[i] = fbm(x, z, 1 / 37, seed + 11);
    }
  return { x0, z0, cell, cols, rows, growth, wear, road, building };
}

function index(f: ReclamationField, x: number, z: number): number {
  const c = Math.floor((x - f.x0) / f.cell),
    r = Math.floor((z - f.z0) / f.cell);
  if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return -1;
  return r * f.cols + c;
}

/** Overgrowth at a world point; outside the field counts as fully reclaimed countryside. */
export function growthAt(f: ReclamationField, x: number, z: number): number {
  const i = index(f, x, z);
  return i < 0 ? 1 : f.growth[i];
}

export function onRoad(f: ReclamationField, x: number, z: number): boolean {
  const i = index(f, x, z);
  return i >= 0 && f.road[i] === 1;
}

export function inBuilding(f: ReclamationField, x: number, z: number): boolean {
  const i = index(f, x, z);
  return i >= 0 && f.building[i] === 1;
}

/** The field as a texture the ground shaders sample: R growth, G wear. */
export function reclamationTexture(f: ReclamationField): THREE.DataTexture {
  const data = new Uint8Array(f.cols * f.rows * 4);
  for (let i = 0; i < f.cols * f.rows; i++) {
    data[i * 4] = Math.round(f.growth[i] * 255);
    data[i * 4 + 1] = Math.round(f.wear[i] * 255);
    data[i * 4 + 2] = f.road[i] * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, f.cols, f.rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export type ReclaimKind = "sidewalk" | "road" | "ground" | "curb" | "park";

/** Shared uniforms: one texture per city, swapped when the city changes. */
export interface ReclaimUniforms {
  uReclaim: { value: THREE.Texture | null };
  /** x0, z0, 1 / width, 1 / depth in metres. */
  uReclaimRect: { value: THREE.Vector4 };
}

export function reclaimUniforms(f: ReclamationField, tex: THREE.Texture): ReclaimUniforms {
  return {
    uReclaim: { value: tex },
    uReclaimRect: { value: new THREE.Vector4(f.x0, f.z0, 1 / (f.cols * f.cell), 1 / (f.rows * f.cell)) },
  };
}

const COMMON = /* glsl */ `
uniform sampler2D uReclaim;
uniform vec4 uReclaimRect;
varying vec3 vReclaimPos;
float rcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rcHash(i), rcHash(i + vec2(1.0, 0.0)), f.x), mix(rcHash(i + vec2(0.0, 1.0)), rcHash(i + vec2(1.0)), f.x), f.y);
}
`;

/**
 * Per kind: how much soil and green each surface takes, and whether its paving
 * is broken into slabs. Colours are linear, picked from photographs of overgrown
 * pavements: dark humus, moss, and the straw of grass that dried in place.
 */
const BODY: Record<ReclaimKind, string> = {
  sidewalk: `float rcDirtK = 1.0; float rcGreenK = 1.0; float rcSlabs = 1.0; float rcWearK = 1.0;`,
  road: `float rcDirtK = 0.4; float rcGreenK = 0.9; float rcSlabs = 0.0; float rcWearK = 0.6;`,
  ground: `float rcDirtK = 1.0; float rcGreenK = 1.0; float rcSlabs = 0.0; float rcWearK = 0.5;`,
  curb: `float rcDirtK = 0.8; float rcGreenK = 0.55; float rcSlabs = 0.0; float rcWearK = 1.0;`,
  park: `float rcDirtK = 0.0; float rcGreenK = 0.0; float rcSlabs = 0.0; float rcWearK = 0.0;`,
};

const FRAGMENT = (kind: ReclaimKind) => /* glsl */ `
{
  ${BODY[kind]}
  vec2 rcP = vReclaimPos.xz;
  vec4 rc = texture2D(uReclaim, (rcP - uReclaimRect.xy) * uReclaimRect.zw);
  float rcGrain = rcNoise(rcP * 0.85) * 0.6 + rcNoise(rcP * 3.3) * 0.4;
  float rcField = rc.r + (rcGrain - 0.5) * 0.38;
  // Regional wear: one stretch of paving greyer and dirtier than the next.
  diffuseColor.rgb *= mix(1.0, mix(0.7, 1.0, rc.g), rcWearK);
  if (rcSlabs > 0.5) {
    // 0.8 m slabs, matching the sidewalk map: each one settled to its own shade,
    // and where growth is heavy some are gone, leaving the bed of earth under them.
    vec2 slab = floor(rcP / 0.8);
    float h = rcHash(slab);
    diffuseColor.rgb *= 0.84 + 0.24 * h;
    float lost = step(rcHash(slab + 17.3), (rcField - 0.42) * 0.9);
    rcField = max(rcField, lost * 0.75);
  }
  vec3 rcSoil = vec3(0.085, 0.062, 0.036) * (0.8 + 0.4 * rcGrain);
  vec3 rcMoss = vec3(0.06, 0.078, 0.022);
  vec3 rcStraw = vec3(0.17, 0.14, 0.055);
  vec3 rcGreen = mix(rcMoss, rcStraw, smoothstep(0.35, 0.75, rcNoise(rcP * 0.21 + 7.0)));
  float rcDirt = smoothstep(0.32, 0.56, rcField) * rcDirtK;
  float rcGrow = smoothstep(0.52, 0.8, rcField) * rcGreenK;
  rcReclaimed = max(rcDirt, rcGrow);
  diffuseColor.rgb = mix(diffuseColor.rgb, rcSoil, rcDirt * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, rcGreen, rcGrow * 0.9);
  ${
    kind === "park"
      ? `
  // A lawn nobody has cut for years: dark where it grew rank, straw where it dried.
  float rank = rcNoise(rcP * 0.13 + 3.0) * 0.65 + rcGrain * 0.35;
  diffuseColor.rgb *= mix(vec3(0.62, 0.66, 0.6), vec3(1.25, 1.08, 0.72), smoothstep(0.3, 0.75, rank));
  float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey), 0.28);
  rcReclaimed = 1.0;`
      : ""
  }
}
`;

/**
 * Lays soil, moss and broken slabs over a ground material. Composes with any
 * onBeforeCompile already set (the layered two-scale sampling).
 */
export function reclaimSurface(material: THREE.MeshStandardMaterial, kind: ReclaimKind, uniforms: ReclaimUniforms): void {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uReclaim = uniforms.uReclaim;
    shader.uniforms.uReclaimRect = uniforms.uReclaimRect;
    shader.vertexShader = "varying vec3 vReclaimPos;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvReclaimPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
    shader.fragmentShader = COMMON + shader.fragmentShader;
    // After colour, so it lands over the layered two-scale sampling rather than under it.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\nfloat rcReclaimed = 0.0;\n${FRAGMENT(kind)}`,
    );
    // Soil and growth are matte, whatever the paving's roughness map says, and dry:
    // rain sheen on the asphalt stops where the moss starts.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, rcReclaimed);",
    );
  };
  material.customProgramCacheKey = () => `${previousKey()}|reclaim-${kind}-v1`;
}
