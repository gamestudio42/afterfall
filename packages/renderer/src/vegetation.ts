import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CityMap } from "@afterfall/world";
import { deriveSeed, distToPolyline, pointInPolygon } from "@afterfall/shared";
import { buildReclamation, growthAt, hash2, type ReclamationField } from "./reclamation";
import { assignLods, CULLED, decimateQuads, LEAF_KEEP, type LodPlant } from "./vegetationLod";

type Species = "manaca" | "pequi" | "dead" | "bush";
export interface Plant {
  species: Species;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  shade: number;
}
/** Instances across every species. Trees cast shadows, so this is the real budget. */
export const VEGETATION_CAP = 900;
/** Street trees outside the parks, within the cap. */
const URBAN_TREE_CAP = 220;

/**
 * Park trees from the map, then the growth that years without a gardener add: parks
 * filled in with more and bigger trees and brush, and trees that seeded themselves
 * in lots, against walls and through the paving, where the reclamation field is thick.
 * Trunks keep clear of roads, buildings and doors; crowns may overhang them.
 */
export function placeVegetation(city: CityMap, field: ReclamationField = buildReclamation(city)): Plant[] {
  const out: Plant[] = [];
  const seed = deriveSeed(city.seed >>> 0, "flora");
  let index = 0;
  const nearRoad = (x: number, z: number, m: number) =>
    city.roads.some((r) =>
      r.path
        ? distToPolyline(x, z, r.path) < (r.width ?? 8) / 2 + m
        : x > r.rect.x - m && x < r.rect.x + r.rect.w + m && z > r.rect.y - m && z < r.rect.y + r.rect.h + m,
    );
  const nearBuilding = (x: number, z: number, m: number) =>
    city.buildings.some((b) => x > b.rect.x - m && x < b.rect.x + b.rect.w + m && z > b.rect.y - m && z < b.rect.y + b.rect.h + m);
  const nearDoor = (x: number, z: number, m: number) => city.buildings.some((b) => Math.hypot(b.entrance.x - x, b.entrance.y - z) < m);
  const clear = (x: number, z: number) => !nearBuilding(x, z, 2) && !nearRoad(x, z, 1.5);
  const inPark = (park: CityMap["parks"][number], x: number, z: number) =>
    park.polygon
      ? pointInPolygon(x, z, park.polygon)
      : x > park.rect.x && x < park.rect.x + park.rect.w && z > park.rect.y && z < park.rect.y + park.rect.h;
  const tree = (n: number, x: number, z: number, big: number): Plant => ({
    species: n % 7 === 0 ? "dead" : n % 3 === 0 ? "pequi" : "manaca",
    x,
    z,
    // Untended for years: most crowns well past the nursery size, a few giants.
    scale: (0.95 + ((n * 37) % 13) / 22) * big,
    yaw: n * 2.399,
    shade: 0.72 + (n % 5) * 0.06,
  });

  for (const park of city.parks) {
    for (const t of park.trees) {
      if (out.length >= VEGETATION_CAP) return out;
      const n = ++index;
      if (!clear(t.x, t.y)) continue;
      out.push(tree(n, t.x, t.y, 1.05));
      const x = t.x + Math.sin(n) * 1.8,
        z = t.y + Math.cos(n) * 1.8;
      if (out.length < VEGETATION_CAP && n % 2 === 0 && inPark(park, x, z) && clear(x, z))
        out.push({ species: "bush", x, z, scale: 0.8 + (n % 3) * 0.2, yaw: n, shade: 0.85 });
    }
  }

  // Parks closing in: a jittered grid of saplings grown up, and brush between them.
  city.parks.forEach((park, pi) => {
    const step = 6.5;
    for (let gz = park.rect.y; gz < park.rect.y + park.rect.h; gz += step)
      for (let gx = park.rect.x; gx < park.rect.x + park.rect.w; gx += step) {
        if (out.length >= VEGETATION_CAP) return;
        const cx = Math.floor(gx / step),
          cz = Math.floor(gz / step);
        const x = gx + hash2(cx, cz, seed + pi) * step,
          z = gz + hash2(cx, cz, seed + pi + 101) * step;
        if (!inPark(park, x, z)) continue;
        const roll = hash2(cx, cz, seed + 7);
        if (roll < 0.5 && clear(x, z)) out.push(tree(++index, x, z, 1.0));
        else if (roll < 0.85 && !nearBuilding(x, z, 1) && !nearRoad(x, z, 0.8))
          out.push({ species: "bush", x, z, scale: 0.9 + hash2(cx, cz, seed + 9) * 0.9, yaw: roll * 40, shade: 0.75 + roll * 0.2 });
      }
  });

  // Trees that seeded themselves outside the parks, wherever the field is thick.
  let urban = 0;
  const step = 9;
  for (let gz = 0; gz < city.height; gz += step)
    for (let gx = 0; gx < city.width; gx += step) {
      if (out.length >= VEGETATION_CAP || urban >= URBAN_TREE_CAP) return out;
      const cx = gx / step,
        cz = gz / step;
      const x = gx + hash2(cx, cz, seed + 13) * step,
        z = gz + hash2(cx, cz, seed + 17) * step;
      const g = growthAt(field, x, z);
      if (g < 0.35 || hash2(cx, cz, seed + 19) > (g - 0.35) * 1.8) continue;
      if (city.parks.some((p) => inPark(p, x, z))) continue;
      if (nearBuilding(x, z, 2.5) || nearRoad(x, z, 1.5) || nearDoor(x, z, 6)) continue;
      urban++;
      out.push(tree(++index, x, z, 1.25));
    }

  // Brush against the walls, where the field is thickest.
  for (let gz = 0; gz < city.height; gz += 4)
    for (let gx = 0; gx < city.width; gx += 4) {
      if (out.length >= VEGETATION_CAP) return out;
      const cx = gx / 4,
        cz = gz / 4;
      const x = gx + hash2(cx, cz, seed + 23) * 4,
        z = gz + hash2(cx, cz, seed + 29) * 4;
      const g = growthAt(field, x, z);
      if (g < 0.72 || hash2(cx, cz, seed + 31) > 0.35) continue;
      if (city.parks.some((p) => inPark(p, x, z))) continue;
      if (nearBuilding(x, z, 0.7) || nearRoad(x, z, 0.8) || nearDoor(x, z, 4)) continue;
      out.push({ species: "bush", x, z, scale: 0.8 + g * 0.7, yaw: x * 0.7 + z, shade: 0.72 + hash2(cx, cz, seed + 37) * 0.25 });
    }
  return out;
}

interface SpeciesLod {
  list: Plant[];
  matrices: Float32Array;
  colors: Float32Array;
  /** Level each plant was last drawn at, or CULLED; null before the first frame. */
  levels: Uint8Array | null;
  scratch: Uint8Array;
  /** Per part (crown, trunk), one mesh per level of detail. */
  parts: THREE.InstancedMesh[][];
}

/** Async replacement of the primitive park kit; every species stays instanced. */
export class Vegetation {
  readonly group = new THREE.Group();
  private disposed = false;
  private resources: { dispose(): void }[] = [];
  private wind = { value: 0 };
  /** One entry per species: its plants, their per-instance data, and one mesh per level and part. */
  private species: SpeciesLod[] = [];
  private frustum = new THREE.Frustum();
  private viewProjection = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  constructor(private readonly fallback: THREE.Object3D | undefined) {
    this.group.name = "refloreste-vegetation";
    this.group.visible = false;
  }
  /** `camera` lets each plant pick its level of detail and drop out when off screen. */
  update(time: number, camera?: THREE.Camera): void {
    this.wind.value = time;
    if (camera && this.species.length) this.updateLods(camera);
  }
  private updateLods(camera: THREE.Camera): void {
    // The renderer refreshes this later in the frame; the first frame and a moved camera need it now.
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const visible = (x: number, y: number, z: number, r: number) => {
      this.sphere.center.set(x, y, z);
      this.sphere.radius = r;
      return this.frustum.intersectsSphere(this.sphere);
    };
    const position = camera.position;
    for (const sp of this.species) {
      assignLods(sp.list as LodPlant[], position, visible, sp.levels, sp.scratch);
      if (sp.levels && sp.levels.every((v, i) => v === sp.scratch[i])) continue;
      [sp.levels, sp.scratch] = [sp.scratch, sp.levels ?? new Uint8Array(sp.list.length)];
      const levels = sp.levels as Uint8Array;
      for (const part of sp.parts) {
        const slot = [0, 0, 0];
        for (let i = 0; i < levels.length; i++) {
          const level = levels[i];
          if (level === CULLED) continue;
          const mesh = part[level];
          const at = slot[level]++;
          (mesh.instanceMatrix.array as Float32Array).set(sp.matrices.subarray(i * 16, i * 16 + 16), at * 16);
          (mesh.instanceColor!.array as Float32Array).set(sp.colors.subarray(i * 3, i * 3 + 3), at * 3);
        }
        part.forEach((mesh, level) => {
          mesh.count = slot[level];
          mesh.visible = slot[level] > 0;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor!.needsUpdate = true;
        });
      }
    }
  }
  /**
   * `density` below 1 keeps an even share of the plants, for software rasterisers: every
   * crown is thousands of triangles drawn twice (colour and shadow), and CI's CPU
   * renderer took 75 % longer per frame with the full 900 than with the old 600-cap park.
   */
  async load(city: CityMap, base: string, field?: ReclamationField, density = 1): Promise<void> {
    const all = placeVegetation(city, field);
    const plants = density >= 1 ? all : all.filter((_, i) => hash2(i, 91, 7) < density);
    if (!plants.length) {
      if (this.fallback) this.fallback.visible = false;
      return;
    }
    try {
      const alpha = await new THREE.TextureLoader().loadAsync(`${base}art/vegetation/leaf_alpha.png`);
      if (this.disposed) {
        alpha.dispose();
        return;
      }
      alpha.magFilter = THREE.LinearFilter;
      this.resources.push(alpha);
      this.addTreeBeds(plants);
      const loaded = await Promise.allSettled(
        (["manaca", "pequi", "dead", "bush"] as Species[]).map(async (species) => {
          const gltf = await new GLTFLoader().loadAsync(`${base}art/vegetation/${species}.glb`);
          gltf.scene.updateMatrixWorld(true);
          const chosen: THREE.Mesh[] = [];
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh && o.name.includes("LOD0")) chosen.push(o);
          });
          const bounds = new THREE.Box3();
          for (const mesh of chosen) bounds.union(new THREE.Box3().setFromObject(mesh));
          const height = bounds.max.y - bounds.min.y;
          if (!height || !chosen.length) throw new Error("Invalid vegetation model");
          const target = species === "bush" ? 1.05 : species === "pequi" ? 5 : 6.5;
          const unit = target / height;
          const list = plants.filter((p) => p.species === species);
          // The kit's other levels, keyed by part: "..._tronco_LOD1" is level 1 of "..._tronco".
          const kit = new Map<string, THREE.Mesh>();
          gltf.scene.traverse((o) => {
            const m = o instanceof THREE.Mesh ? /^(.*)_LOD(\d)$/.exec(o.name) : null;
            if (m) kit.set(`${m[1]}#${m[2]}`, o as THREE.Mesh);
          });
          const prepare = (mesh: THREE.Mesh) => {
            const geo = mesh.geometry.clone();
            geo.applyMatrix4(mesh.matrixWorld);
            geo.translate(0, -bounds.min.y, 0);
            geo.scale(unit, unit, unit);
            return geo;
          };
          // Per-instance data is shared by every part and level of the species.
          const matrices = new Float32Array(list.length * 16);
          const colors = new Float32Array(list.length * 3);
          {
            const matrix = new THREE.Matrix4(),
              q = new THREE.Quaternion(),
              v = new THREE.Vector3(),
              s = new THREE.Vector3(),
              up = new THREE.Vector3(0, 1, 0);
            list.forEach((p, i) => {
              q.setFromAxisAngle(up, p.yaw);
              matrix.compose(v.set(p.x, 0.08, p.z), q, s.setScalar(p.scale)).toArray(matrices, i * 16);
              colors.fill(p.shade, i * 3, i * 3 + 3);
            });
          }
          const sp: SpeciesLod = { list, matrices, colors, levels: null, scratch: new Uint8Array(list.length), parts: [] };
          for (const child of chosen) {
            const leaves = child.name.includes("folhagem");
            const key = child.name.replace(/_LOD0$/, "");
            const mat = new THREE.MeshStandardMaterial({
              color: leaves ? (species === "bush" ? 0x5f6f3c : species === "pequi" ? 0x707645 : 0x6a7c3e) : 0x73614b,
              vertexColors: true,
              roughness: 1,
              side: leaves ? THREE.DoubleSide : THREE.FrontSide,
              alphaMap: leaves ? alpha : null,
              alphaTest: leaves ? 0.5 : 0,
            });
            this.resources.push(mat);
            let depth: THREE.MeshDepthMaterial | null = null;
            if (leaves) {
              depth = new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                alphaMap: alpha,
                alphaTest: 0.5,
                side: THREE.DoubleSide,
              });
              this.resources.push(depth);
              // Shared deformation in color and shadow passes; roots remain planted.
              for (const material of [mat, depth]) {
                material.onBeforeCompile = (shader) => {
                  shader.uniforms.vegetationTime = this.wind;
                  shader.vertexShader = "uniform float vegetationTime;\n" + shader.vertexShader;
                  shader.vertexShader = shader.vertexShader.replace(
                    "#include <begin_vertex>",
                    `#include <begin_vertex>
                  vec3 treeWorld = (instanceMatrix * vec4(position, 1.0)).xyz;
                  float flutter = sin(vegetationTime * 1.3 + treeWorld.x * 0.7 + treeWorld.z * 0.4);
                  transformed.x += flutter * min(position.y * 0.012, 0.07);
                `,
                  );
                };
                material.customProgramCacheKey = () => "refloreste-wind-v1";
              }
            }
            // Level 0 as authored; each further level from the kit when it has one, else
            // (the crowns of the manacá and the pequi) a thinned copy of level 0.
            const geos: THREE.BufferGeometry[] = [prepare(child)];
            for (let level = 1; level < LEAF_KEEP.length; level++) {
              const other = kit.get(`${key}#${level}`);
              geos.push(other ? prepare(other) : leaves ? decimateQuads(geos[0], LEAF_KEEP[level]) : geos[level - 1]);
            }
            const meshes = geos.map((geo, level) => {
              if (!this.resources.includes(geo)) this.resources.push(geo);
              const mesh = new THREE.InstancedMesh(geo, mat, list.length);
              mesh.name = `vegetation-${species}-${leaves ? "leaves" : "trunk"}${level ? `-lod${level}` : ""}`;
              mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
              mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
              mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
              if (level === 0) {
                // Everything starts at full detail, until the first frame picks a level.
                (mesh.instanceMatrix.array as Float32Array).set(matrices);
                (mesh.instanceColor.array as Float32Array).set(colors);
              } else {
                mesh.count = 0;
                mesh.visible = false;
              }
              // Culled per instance by `update`, not as one box around every plant.
              mesh.frustumCulled = false;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              if (depth) mesh.customDepthMaterial = depth;
              this.resources.push(mesh);
              this.group.add(mesh);
              return mesh;
            });
            sp.parts.push(meshes);
          }
          this.species.push(sp);
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.geometry.dispose();
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
            }
          });
        }),
      );
      if (this.disposed || loaded.some((r) => r.status === "rejected")) {
        this.dispose();
        return;
      }
      this.group.visible = true;
      if (this.fallback) this.fallback.visible = false;
    } catch {
      this.dispose();
    }
  }
  /** Soft, irregular earth at the roots gives the crowns contact with the ground. */
  private addTreeBeds(plants: Plant[]): void {
    const trees = plants.filter((p) => p.species !== "bush");
    const geo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5b5138,
      roughness: 1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = "varying vec2 bedUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nbedUv = uv;");
      shader.fragmentShader = "varying vec2 bedUv;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        `
        vec2 p = bedUv * 2.0 - 1.0;
        float edge = length(p) + sin(p.x * 19.0 + p.y * 8.0) * 0.06 + sin(p.y * 23.0) * 0.04;
        diffuseColor.a *= (1.0 - smoothstep(0.2, 1.0, edge)) * 0.65;
        #include <alphatest_fragment>`,
      );
    };
    mat.customProgramCacheKey = () => "tree-bed-v1";
    const mesh = new THREE.InstancedMesh(geo, mat, trees.length);
    mesh.name = "vegetation-root-beds";
    mesh.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    trees.forEach((p, i) => {
      matrix
        .makeRotationY(p.yaw)
        .scale(new THREE.Vector3(2.3 * p.scale, 1, 1.8 * p.scale))
        .setPosition(p.x, 0.09, p.z);
      mesh.setMatrixAt(i, matrix);
    });
    this.resources.push(geo, mat, mesh);
    this.group.add(mesh);
  }
  dispose(): void {
    this.disposed = true;
    this.species = [];
    this.group.clear();
    for (const r of this.resources) r.dispose();
    this.resources = [];
  }
}
