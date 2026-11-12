import * as THREE from "three";

export type WeatherKind = "clear" | "overcast" | "rain" | "fog";

/** What a kind of weather does to the picture, each from 0 to 1. */
export interface WeatherState {
  /** Cloud cover in the sky. */
  cloud: number;
  /** Rain falling. */
  rain: number;
  /** How far the fog closes in. */
  fog: number;
  /** How much of the sun the sky takes away. */
  dim: number;
}

export const WEATHER: Record<WeatherKind, WeatherState> = {
  clear: { cloud: 0.25, rain: 0, fog: 0, dim: 0 },
  overcast: { cloud: 0.85, rain: 0, fog: 0.15, dim: 0.4 },
  rain: { cloud: 1, rain: 1, fog: 0.35, dim: 0.55 },
  fog: { cloud: 0.6, rain: 0, fog: 1, dim: 0.35 },
};

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The weather of a day, from the game's seed: the same run has the same
 * weather every time. It is picture only, and deliberately so: the simulation
 * does not know it rains, so nothing here can change a balance number. The
 * first day is always clear, because it is the first thing a player sees.
 */
export function weatherFor(seed: number, day: number): WeatherKind {
  if (day <= 1) return "clear";
  const r = hash(seed, day * 7919);
  if (r < 0.5) return "clear";
  if (r < 0.7) return "overcast";
  if (r < 0.88) return "rain";
  return "fog";
}

/** Moves the current state toward a kind's, so a front arrives instead of switching on. */
export function easeWeather(current: WeatherState, target: WeatherState, dt: number, seconds = 12): WeatherState {
  const k = seconds <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / (seconds / 3));
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    cloud: mix(current.cloud, target.cloud),
    rain: mix(current.rain, target.rain),
    fog: mix(current.fog, target.fog),
    dim: mix(current.dim, target.dim),
  };
}

/** The box of air around the camera's target that rain falls through, in metres. */
const BOX = 150;
const HEIGHT = 70;

/**
 * Rain as line segments: one draw call, every drop placed and moved in the
 * vertex shader from a seed, wrapping inside a box that follows the camera.
 * Nothing is updated on the CPU per frame but three uniforms.
 */
export class Rain {
  readonly lines: THREE.LineSegments;
  private material: THREE.ShaderMaterial;

  constructor(drops: number) {
    const seed = new Float32Array(drops * 2 * 3);
    const end = new Float32Array(drops * 2);
    let s = 0x9e3779b9;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < drops; i++) {
      const x = rnd();
      const y = rnd();
      const z = rnd();
      for (let v = 0; v < 2; v++) {
        seed.set([x, y, z], (i * 2 + v) * 3);
        end[i * 2 + v] = v;
      }
    }
    const geo = new THREE.BufferGeometry();
    // Positions are computed in the shader; the attribute only sizes the draw.
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(drops * 2 * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uAmount: { value: 0 },
        uLight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        varying float vFade;
        void main() {
          float speed = 34.0 + aSeed.x * 14.0;
          vec3 p;
          p.x = (aSeed.x - 0.5) * ${BOX.toFixed(1)};
          p.z = (aSeed.z - 0.5) * ${BOX.toFixed(1)};
          p.y = mod(aSeed.y * ${HEIGHT.toFixed(1)} - uTime * speed, ${HEIGHT.toFixed(1)});
          // Wrap around the camera's target, so the box moves without the drops jumping.
          // Both ends wrap by the head's position: wrapped separately, a streak
          // on the box's edge had its ends a box apart and drew a line across the sky.
          vec3 c = uCenter;
          p.x += floor((c.x - p.x) / ${BOX.toFixed(1)} + 0.5) * ${BOX.toFixed(1)};
          p.z += floor((c.z - p.z) / ${BOX.toFixed(1)} + 0.5) * ${BOX.toFixed(1)};
          // The streak: its tail sits above the head, leaning with the wind.
          p += aEnd * vec3(0.35, 1.9, 0.12);
          vFade = 1.0 - aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmount;
        uniform float uLight;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(vec3(0.72, 0.78, 0.86) * uLight, uAmount * (0.16 + 0.3 * vFade));
        }`,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.name = "rain";
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.lines.visible = false;
  }

  /** `amount` 0..1 is how hard it rains; `light` dims the streaks at night. */
  update(time: number, center: THREE.Vector3, amount: number, light: number): void {
    this.lines.visible = amount > 0.02;
    if (!this.lines.visible) return;
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).copy(center);
    u.uAmount.value = amount;
    u.uLight.value = light;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
