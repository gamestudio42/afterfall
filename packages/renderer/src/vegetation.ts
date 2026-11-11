import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CityMap } from "@afterfall/world";
import { distToPolyline, pointInPolygon } from "@afterfall/shared";

type Species = "manaca" | "pequi" | "dead" | "bush";
export interface Plant {
  species: Species;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  shade: number;
}
export function placeVegetation(city: CityMap): Plant[] {
  const out: Plant[] = [];
  let index = 0;
  const clear = (x: number, z: number) =>
    !city.buildings.some((b) => x > b.rect.x - 2 && x < b.rect.x + b.rect.w + 2 && z > b.rect.y - 2 && z < b.rect.y + b.rect.h + 2) &&
    !city.roads.some((r) =>
      r.path
        ? distToPolyline(x, z, r.path) < (r.width ?? 8) / 2 + 1.5
        : x > r.rect.x - 1.5 && x < r.rect.x + r.rect.w + 1.5 && z > r.rect.y - 1.5 && z < r.rect.y + r.rect.h + 1.5,
    );
  for (const park of city.parks) {
    for (const t of park.trees) {
      if (out.length >= 600) return out;
      const n = ++index;
      if (!clear(t.x, t.y)) continue;
      out.push({
        species: n % 9 === 0 ? "dead" : n % 3 === 0 ? "pequi" : "manaca",
        x: t.x,
        z: t.y,
        scale: 0.82 + ((n * 37) % 13) / 35,
        yaw: n * 2.399,
        shade: 0.8 + (n % 5) * 0.05,
      });
      const x = t.x + Math.sin(n) * 1.8,
        z = t.y + Math.cos(n) * 1.8;
      const inPark = park.polygon
        ? pointInPolygon(x, z, park.polygon)
        : x > park.rect.x && x < park.rect.x + park.rect.w && z > park.rect.y && z < park.rect.y + park.rect.h;
      if (out.length < 600 && n % 2 === 0 && inPark && clear(x, z))
        out.push({ species: "bush", x, z, scale: 0.7 + (n % 3) * 0.15, yaw: n, shade: 0.85 });
    }
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
  async load(city: CityMap, base: string): Promise<void> {
    const plants = placeVegetation(city);
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
