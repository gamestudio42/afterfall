import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * auto: on with a hardware GPU, off under a software rasteriser. on and off
 * force it, for captures and for a player whose machine disagrees with auto.
 */
export type PostMode = "auto" | "on" | "off";

/**
 * Whether WebGL is being drawn by the CPU (SwiftShader in headless Chromium,
 * llvmpipe on a Linux box without a driver). The post chain is four extra
 * full-screen passes: free on a GPU, and a frame-rate cut on a rasteriser
 * that already spends 360 ms a frame, which is also what CI runs on.
 */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|software|softpipe|microsoft basic render/i.test(name);
}

/** The name the driver reports, or an empty string when the browser hides it. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === "string" ? name : "";
}

export function resolvePost(mode: PostMode, renderer: string): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return !isSoftwareRenderer(renderer);
}

/** Bloom and grade for a moment of the day, 0 at night and 1 at noon. */
export interface Mood {
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  saturation: number;
  contrast: number;
  vignette: number;
  /** Colour the shadows lean toward, and the highlights. */
  shadows: [number, number, number];
  highlights: [number, number, number];
}

const NIGHT: Mood = {
  // At night almost nothing is bright, so a low threshold only catches lamps,
  // lit windows, the base's light and gunfire, and lets them carry the frame.
  bloomStrength: 0.62,
  bloomThreshold: 0.32,
  bloomRadius: 0.7,
  saturation: 0.92,
  contrast: 1.08,
  vignette: 0.42,
  shadows: [0.9, 0.97, 1.12],
  highlights: [1.06, 1.0, 0.9],
};

const DAY: Mood = {
  // By day only what is over white blooms: sun on pale concrete, glass glints.
  bloomStrength: 0.22,
  bloomThreshold: 0.92,
  bloomRadius: 0.45,
  saturation: 1.14,
  contrast: 1.07,
  vignette: 0.22,
  shadows: [0.98, 1.0, 1.03],
  highlights: [1.04, 1.01, 0.96],
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The mood between night (0) and day (1). Pure, so it can be tested without WebGL. */
export function moodAt(daylight: number, dim = 0): Mood {
  const t = Math.max(0, Math.min(1, daylight));
  // Bad weather drains colour: under cloud or rain the grade pulls saturation down.
  const drain = 1 - 0.28 * Math.max(0, Math.min(1, dim));
  const mix3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
  return {
    bloomStrength: lerp(NIGHT.bloomStrength, DAY.bloomStrength, t),
    bloomThreshold: lerp(NIGHT.bloomThreshold, DAY.bloomThreshold, t),
    bloomRadius: lerp(NIGHT.bloomRadius, DAY.bloomRadius, t),
    saturation: lerp(NIGHT.saturation, DAY.saturation, t) * drain,
    contrast: lerp(NIGHT.contrast, DAY.contrast, t),
    vignette: lerp(NIGHT.vignette, DAY.vignette, t),
    shadows: mix3(NIGHT.shadows, DAY.shadows),
    highlights: mix3(NIGHT.highlights, DAY.highlights),
  };
}

/**
 * The grade runs last, on display-referred colour (after tone mapping and the
 * sRGB transfer), which is where "a bit more contrast" means what it says.
 * Split toning, saturation, an S-curve around mid grey, and a vignette that
 * darkens the corners so the eye stays on the settlement.
 */
const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0.25 },
    uShadows: { value: new THREE.Vector3(1, 1, 1) },
    uHighlights: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform vec3 uShadows;
    uniform vec3 uHighlights;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split tone: shadows lean one way, highlights the other.
      c *= mix(uShadows, uHighlights, smoothstep(0.0, 0.75, luma));
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.35, 0.95, length(d * vec2(1.0, 0.85)) * 1.35);
      c *= 1.0 - uVignette * v;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
    }`,
};

/**
 * The frame after the scene: bloom on what is brighter than the moment's
 * threshold, tone mapping, then the grade. The scene is drawn into a
 * half-float target with MSAA, so highlights keep their range for the bloom
 * and the edges keep the antialiasing the canvas had.
 */
export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), DAY.bloomStrength, DAY.bloomRadius, DAY.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setMood(1);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  setMood(daylight: number, dim = 0): void {
    const m = moodAt(daylight, dim);
    this.bloom.strength = m.bloomStrength;
    this.bloom.threshold = m.bloomThreshold;
    this.bloom.radius = m.bloomRadius;
    const u = this.grade.uniforms;
    u.uSaturation.value = m.saturation;
    u.uContrast.value = m.contrast;
    u.uVignette.value = m.vignette;
    (u.uShadows.value as THREE.Vector3).fromArray(m.shadows);
    (u.uHighlights.value as THREE.Vector3).fromArray(m.highlights);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.grade.dispose();
  }
}
