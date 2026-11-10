/**
 * Draws the wear atlas the streets lay on the ground: cracks, patched asphalt, oil,
 * rubble, weeds through the joints and drifted leaves.
 *
 * Everything is procedural and deterministic, like the surface maps in
 * `make-textures.ts`, so the same seed and the same file come out of every run. The atlas
 * is 4 by 2 tiles of 128 px, which keeps it under 200 KB and lets the renderer merge every
 * decal of a map into one instanced-free mesh with per-vertex UVs.
 *
 * Usage: pnpm assets:decals
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePng } from "./png";

const TILE = 128;
const COLS = 4;
const ROWS = 2;
const W = TILE * COLS;
const H = TILE * ROWS;
const OUT = resolve(import.meta.dirname, "../apps/web/public/art");
const MANIFEST = resolve(OUT, "manifest.json");

/** Tile order is the contract with `decals.ts`: do not reorder without changing both. */
const TILES = ["crack_a", "crack_b", "patch", "oil", "rubble", "weeds", "leaves", "soot"] as const;

function hash(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, cells: number, seed: number): number {
  const fx = (x / TILE) * cells;
  const fy = (y / TILE) * cells;
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

/** A branch: a wandering line from the tile edge toward the middle. */
function crackMask(x: number, y: number, seed: number, width: number): number {
  // Warp the sample point, then measure the distance to a jagged vertical line.
  const wobble = (noise(x, y, 5, seed) - 0.5) * 26 + (noise(x, y, 13, seed + 7) - 0.5) * 9;
  const centre = TILE / 2 + wobble + (x / TILE - 0.5) * 18;
  const d = Math.abs(y - centre);
  const taper = 1 - Math.abs(x / TILE - 0.5) * 1.4;
  const edge = width * taper * (0.55 + noise(x, y, 21, seed + 3) * 0.8);
  return Math.max(0, 1 - d / Math.max(0.001, edge));
}

type Pixel = (x: number, y: number) => [number, number, number, number];

function tile(pixels: Uint8ClampedArray, index: number, shade: Pixel): void {
  const ox = (index % COLS) * TILE;
  const oy = Math.floor(index / COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b, a] = shade(x, y);
      const i = ((oy + y) * W + (ox + x)) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
}

function main(): void {
  const pixels = new Uint8ClampedArray(W * H * 4);

  // 0-1. Cracks: dark, thin, fading at the edges so they sit in the asphalt.
  for (const [index, seed, width] of [
    [0, 11, 4.2],
    [1, 29, 6.0],
  ] as const) {
    tile(pixels, index, (x, y) => {
      const m = crackMask(x, y, seed, width);
      // A second, finer crack crossing it, so the shape is not a single wand.
      const m2 = crackMask(y, x, seed + 41, width * 0.55) * 0.85;
      const a = Math.max(m, m2);
      if (a <= 0.02) return [0, 0, 0, 0];
      if (a < 0.46) {
        // The lip: sun-bleached aggregate along the break, which is what makes a crack
        // visible from an RTS camera instead of vanishing into the asphalt.
        const lip = 104 + Math.round(noise(x, y, 17, seed + 5) * 36);
        return [lip, lip - 2, lip - 6, Math.round((0.46 - a) * 1.4 * 190)];
      }
      const shade = 24 + Math.round(noise(x, y, 9, seed) * 18);
      return [shade, shade, shade + 2, 215];
    });
  }

  // 2. Patched asphalt: a rectangle of fresher tarmac with a ragged edge.
  tile(pixels, 2, (x, y) => {
    const inset = 15 + (noise(x, y, 6, 5) - 0.5) * 14;
    if (x < inset || y < inset || x > TILE - inset || y > TILE - inset) return [0, 0, 0, 0];
    const n = noise(x, y, 16, 5);
    const shade = 46 + Math.round(n * 20);
    return [shade, shade - 2, shade - 6, 175];
  });

  // 3. Oil: a dark blot with a thin sheen ring.
  tile(pixels, 3, (x, y) => {
    const dx = (x - TILE / 2) / (TILE * 0.36);
    const dy = (y - TILE / 2) / (TILE * 0.3);
    const d = Math.hypot(dx, dy) + (noise(x, y, 7, 13) - 0.5) * 0.35;
    if (d > 1) return [0, 0, 0, 0];
    const a = (1 - d) * 210;
    const sheen = d > 0.72 ? 26 : 0;
    const shade = 20 + sheen + Math.round(noise(x, y, 18, 13) * 10);
    return [shade, shade, shade + 6, Math.round(a)];
  });

  // 4. Rubble: chunks of concrete with dust between them.
  tile(pixels, 4, (x, y) => {
    const n = noise(x, y, 9, 17);
    const grain = noise(x, y, 34, 19);
    const dx = (x - TILE / 2) / (TILE * 0.42);
    const dy = (y - TILE / 2) / (TILE * 0.34);
    const d = Math.hypot(dx, dy) + (noise(x, y, 5, 21) - 0.5) * 0.5;
    if (d > 1) return [0, 0, 0, 0];
    const chunk = n > 0.55 ? 1 : 0;
    const shade = chunk ? 118 + Math.round(grain * 60) : 86 + Math.round(grain * 30);
    return [shade, shade - 4, shade - 12, Math.round((1 - d * 0.75) * (chunk ? 245 : 150))];
  });

  // 5. Weeds: a fan of thin blades pushing through a dark joint, olive rather than lawn.
  tile(pixels, 5, (x, y) => {
    const seam = Math.abs(y - TILE * 0.66) < 2.4 ? 120 : 0;
    let best = 0;
    let tone = 0;
    for (let b = 0; b < 34; b++) {
      const baseX = TILE * 0.5 + (hash(b, 1, 23) - 0.5) * 44;
      const height = TILE * (0.2 + hash(b, 2, 23) * 0.38);
      const lean = (hash(b, 3, 23) - 0.5) * 26;
      const topY = TILE * 0.66 - height;
      if (y > TILE * 0.67 || y < topY) continue;
      const t = (TILE * 0.66 - y) / Math.max(1, height);
      const cx = baseX + lean * t * t;
      const halfWidth = 2.6 * (1 - t * 0.5);
      const d = Math.abs(x - cx);
      if (d > halfWidth) continue;
      const a = (1 - d / halfWidth) * (0.7 + hash(b, 4, 23) * 0.3) * 250;
      if (a > best) {
        best = a;
        tone = hash(b, 5, 23);
      }
    }
    if (best > 1) {
      // Dry, half-dead grass: olive with a few bleached blades.
      const dry = tone > 0.72 ? 1 : 0;
      const r = dry ? 122 : 66 + Math.round(tone * 26);
      const g = dry ? 112 : 92 + Math.round(tone * 32);
      const bl = dry ? 66 : 40 + Math.round(tone * 16);
      return [r, g, bl, Math.round(Math.max(best, seam))];
    }
    if (seam) return [26, 25, 24, seam];
    return [0, 0, 0, 0];
  });

  // 6. Leaves and litter drifted into a drift against the kerb: small, dull, sparse.
  tile(pixels, 6, (x, y) => {
    let a = 0;
    let warm = 0;
    for (let l = 0; l < 64; l++) {
      const cx = TILE * 0.5 + (hash(l, 11, 31) - 0.5) * TILE * 0.78;
      const cy = TILE * 0.58 + (hash(l, 12, 31) - 0.5) * TILE * 0.42;
      const rx = 2.2 + hash(l, 13, 31) * 3.2;
      const ry = 1.5 + hash(l, 14, 31) * 2.0;
      const ang = hash(l, 15, 31) * Math.PI;
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * Math.cos(ang) + dy * Math.sin(ang);
      const v = -dx * Math.sin(ang) + dy * Math.cos(ang);
      const d = (u * u) / (rx * rx) + (v * v) / (ry * ry);
      if (d > 1) continue;
      const shade = 0.45 + hash(l, 16, 31) * 0.55;
      if (shade * 235 > a) {
        a = shade * 235;
        warm = hash(l, 17, 31);
      }
    }
    if (a < 8) return [0, 0, 0, 0];
    return [96 + Math.round(warm * 44), 74 + Math.round(warm * 32), 40 + Math.round(warm * 20), Math.round(a)];
  });

  // 7. Soot: a burn mark with a soft edge, for a building that burned.
  tile(pixels, 7, (x, y) => {
    const dx = (x - TILE / 2) / (TILE * 0.4);
    const dy = (y - TILE / 2) / (TILE * 0.38);
    const d = Math.hypot(dx, dy) + (noise(x, y, 6, 37) - 0.5) * 0.45;
    if (d > 1) return [0, 0, 0, 0];
    const shade = 14 + Math.round(noise(x, y, 20, 37) * 16);
    return [shade, shade, shade, Math.round((1 - d) * 210)];
  });

  const png = encodePng(W, H, new Uint8Array(pixels.buffer));
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, "decals.png");
  writeFileSync(file, png);
  console.log(`${file}  ${W}x${H}  ${(png.length / 1024).toFixed(0)} KB`);

  // Record it in the same manifest the surface maps use.
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    version: number;
    assets: { file: string; width: number; height: number; bytes: number; sha256: string; generator: string }[];
  };
  const entry = {
    file: "decals.png",
    width: W,
    height: H,
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
    generator: "tools/make-decals.ts",
  };
  const at = manifest.assets.findIndex((a) => a.file === "decals.png");
  if (at >= 0) manifest.assets[at] = entry;
  else manifest.assets.push(entry);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: decals.png ${TILES.length} tiles`);
}

main();
