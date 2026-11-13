import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CityMap } from "@afterfall/world";
import { deriveSeed, distToPolyline, pointInPolygon } from "@afterfall/shared";
import { buildReclamation, growthAt, hash2, type ReclamationField } from "./reclamation";

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

/** Async replacement of the primitive park kit; every species stays instanced. */
export class Vegetation {
  readonly group = new THREE.Group();
  private disposed = false;
  private resources: { dispose(): void }[] = [];
  private wind = { value: 0 };
  constructor(private readonly fallback: THREE.Object3D | undefined) {
    this.group.name = "refloreste-vegetation";
    this.group.visible = false;
  }
  update(time: number): void {
    this.wind.value = time;
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
          for (const child of chosen) {
            const geo = child.geometry.clone();
            geo.applyMatrix4(child.matrixWorld);
            geo.translate(0, -bounds.min.y, 0);
            geo.scale(unit, unit, unit);
            const leaves = child.name.includes("folhagem");
            const mat = new THREE.MeshStandardMaterial({
              color: leaves ? (species === "bush" ? 0x667741 : species === "pequi" ? 0x7a814a : 0x758a42) : 0x73614b,
              vertexColors: true,
              roughness: 1,
              side: leaves ? THREE.DoubleSide : THREE.FrontSide,
              alphaMap: leaves ? alpha : null,
              alphaTest: leaves ? 0.5 : 0,
            });
            const mesh = new THREE.InstancedMesh(geo, mat, list.length);
            mesh.name = `vegetation-${species}-${leaves ? "leaves" : "trunk"}`;
            const matrix = new THREE.Matrix4(),
              q = new THREE.Quaternion(),
              v = new THREE.Vector3(),
              s = new THREE.Vector3(),
              color = new THREE.Color();
            list.forEach((p, i) => {
              q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
              matrix.compose(v.set(p.x, 0.08, p.z), q, s.setScalar(p.scale));
              mesh.setMatrixAt(i, matrix);
              mesh.setColorAt(i, color.setScalar(p.shade));
            });
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.resources.push(geo, mat, mesh);
            if (leaves) {
              const depth = new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                alphaMap: alpha,
                alphaTest: 0.5,
                side: THREE.DoubleSide,
              });
              mesh.customDepthMaterial = depth;
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
            this.group.add(mesh);
          }
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
    this.group.clear();
    for (const r of this.resources) r.dispose();
    this.resources = [];
  }
}
