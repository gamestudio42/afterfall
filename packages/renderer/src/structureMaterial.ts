import * as THREE from "three";

/** Metre-scaled surface detail stays continuous across instanced wall modules. */
export function structureMaterial(source: THREE.MeshStandardMaterial, vertexColors: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: source.name,
    color: source.color.clone(),
    vertexColors,
    roughness: source.roughness,
    metalness: source.metalness,
    flatShading: true,
  });
  const timber = source.name.includes("timber");
  const hardware = source.name.includes("hardware");
  material.customProgramCacheKey = () => `structure-surface-1-${source.name}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      varying vec3 vStructureSurface;
      varying float vStructureHeight;
      attribute float structureDamage;
      varying float vStructureDamage;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      vec4 surfacePosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        surfacePosition = instanceMatrix * surfacePosition;
      #endif
      vStructureSurface = surfacePosition.xyz;
      vStructureHeight = transformed.y;
      vStructureDamage = structureDamage;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      varying vec3 vStructureSurface;
      varying float vStructureHeight;
      varying float vStructureDamage;
      float structureHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float structureNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(structureHash(i), structureHash(i+vec3(1,0,0)), f.x),
                       mix(structureHash(i+vec3(0,1,0)), structureHash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(structureHash(i+vec3(0,0,1)), structureHash(i+vec3(1,0,1)), f.x),
                       mix(structureHash(i+vec3(0,1,1)), structureHash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec3 p = vStructureSurface;
      float broad = structureNoise(p * 2.3);
      float grain = structureNoise(p * ${timber ? "vec3(26.0, 1.6, 26.0)" : "30.0"});
      float dirt = (1.0-smoothstep(0.0, .65, vStructureHeight)) * (.22 + broad*.24);
      float fracture = abs(sin((p.x + p.z)*5.0 + p.y*3.0 + structureNoise(p*5.0)*3.0));
      float crack = (1.0-smoothstep(.025,.10,fracture)) * smoothstep(.15,.8,vStructureDamage);
      diffuseColor.rgb *= .80 + .24*broad + .12*grain;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.43,.38,.28), dirt);
      diffuseColor.rgb *= 1.0 - crack*.78;
      ${hardware ? "float rust = smoothstep(.54,.78,structureNoise(p*7.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.19,.075,.028),rust*.65*step(diffuseColor.b,diffuseColor.r*1.3));" : ""}
      ${!timber && !hardware ? "float pores = smoothstep(.72,.86,grain); diffuseColor.rgb *= 1.0-pores*.28;" : ""}
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + (grain-.5)*.12 + dirt*.15, .35, 1.0);`,
    );
  };
  return material;
}
