/**
 * Generates the tiling surface textures the renderer uses, straight into
 * `apps/web/public/art/`. Everything here is a function of period integer
 * frequencies, so every tile wraps exactly and the result is deterministic.
 *
 * Usage: pnpm assets:textures
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { encodePng } from "./png";

const SIZE = 256;
const OUT = resolve(import.meta.dirname, "../apps/web/public/art");

/** Deterministic hash noise in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a periodic lattice: `cells` divides the tile exactly. */
function valueNoise(x: number, y: number, cells: number, seed: number): number {
  const fx = (x / SIZE) * cells;
  const fy = (y / SIZE) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (dx: number, dy: number) => hash((x0 + dx + cells) % cells, (y0 + dy + cells) % cells, seed);
  const top = w(0, 0) + (w(1, 0) - w(0, 0)) * sx;
  const bottom = w(0, 1) + (w(1, 1) - w(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Sum of periodic noise octaves; each octave keeps the tile seamless. */
function fbm(x: number, y: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, base << o, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

type Pixel = (x: number, y: number) => [number, number, number];

interface Entry {
  name: string;
  file: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  generator: string;
}
const manifest: Entry[] = [];

function write(name: string, shade: Pixel): void {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = shade(x, y);
      const i = (y * SIZE + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[i + 3] = 255;
    }
  }
  const file = resolve(OUT, `${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  const png = encodePng(SIZE, SIZE, rgba);
  writeFileSync(file, png);
  manifest.push({
    name,
    file: `${name}.png`,
    width: SIZE,
    height: SIZE,
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
    generator: "tools/make-textures.ts",
  });
  console.log(`${file}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(0)} KB`);
}

/** Weathered concrete: pale grey, wide stains, fine grain and the faint seams
 * of the formwork it was cast in. Kept light so the per-building vertex colour
 * still drives the palette. */
write("concrete", (x, y) => {
  const grain = fbm(x, y, 64, 3, 11);
  const stain = Math.pow(fbm(x, y, 3, 4, 23), 1.8);
  const patch = fbm(x, y, 1, 2, 91);
  // Formwork: panel joints every 128 px across and 64 px up, one pixel wide,
  // which also reads as a course line at any scale.
  const seam = x % 128 === 0 || y % 64 === 0 ? 0.9 : 1;
  // Kept around mid grey on purpose: the map multiplies the per-building
  // vertex colour, and a bright map would wash the palette out.
  const v = (140 + grain * 54 + patch * 34) * (1 - stain * 0.26) * seam;
  return [v * 1.03, v, v * 0.95];
});

/** Asphalt: dark, coarse aggregate, faint patch seams. */
write("asphalt", (x, y) => {
  const grain = fbm(x, y, 64, 3, 5);
  const patch = fbm(x, y, 3, 2, 61);
  const speck = valueNoise(x, y, 128, 71) > 0.93 ? 34 : 0;
  const v = 58 + grain * 34 + patch * 14 + speck;
  return [v, v * 1.01, v * 1.06];
});

/** Grass gone wild: clumps, dry patches and a darker undergrowth. */
write("grass", (x, y) => {
  const clump = fbm(x, y, 24, 4, 3);
  const tuft = fbm(x, y, 96, 2, 13);
  const dry = Math.pow(fbm(x, y, 4, 3, 47), 2);
  return [40 + clump * 46 + dry * 46 + tuft * 12, 58 + clump * 54 + dry * 30 + tuft * 14, 28 + clump * 26 + tuft * 9];
});

/** Rusted metal: orange-brown blotches over a grey base, for props and gates. */
write("rust", (x, y) => {
  const blotch = Math.pow(fbm(x, y, 6, 4, 17), 1.6);
  const grain = fbm(x, y, 48, 2, 29);
  const r = 120 + blotch * 90 + grain * 20;
  const g = 96 + blotch * 52 + grain * 16;
  const b = 84 + blotch * 18 + grain * 12;
  return [r, g, b];
});

// The manifest is written by the generator, never by hand, so it cannot drift
// from the bytes it describes. `pnpm assets:check` verifies it in CI.
const manifestFile = resolve(OUT, "manifest.json");
writeFileSync(
  manifestFile,
  `${JSON.stringify(
    {
      version: 1,
      note: "Generated by tools/make-textures.ts. Run pnpm assets:check to verify.",
      assets: manifest,
    },
    null,
    2,
  )}\n`,
);
console.log(`${manifestFile}  ${manifest.length} assets`);
