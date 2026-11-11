/** Deterministic, seamless urban surfaces. Run: node --import tsx tools/make-surfaces.ts */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePng } from "./png";

const SIZE = 512;
const root = resolve(import.meta.dirname, "../apps/web/public/art");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, cells: number, seed: number): number {
  const u = (x / SIZE) * cells,
    v = (y / SIZE) * cells;
  const i = Math.floor(u),
    j = Math.floor(v);
  const a = (u - i) ** 2 * (3 - 2 * (u - i)),
    b = (v - j) ** 2 * (3 - 2 * (v - j));
  const sample = (dx: number, dy: number) => hash((i + dx + cells) % cells, (j + dy + cells) % cells, seed);
  return (sample(0, 0) * (1 - a) + sample(1, 0) * a) * (1 - b) + (sample(0, 1) * (1 - a) + sample(1, 1) * a) * b;
}
function write(name: string, pixel: (x: number, y: number) => number[]) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const mean = [0, 0, 0];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const c = pixel(x, y);
      const at = (y * SIZE + x) * 4;
      for (let k = 0; k < 3; k++) {
        rgba[at + k] = Math.max(0, Math.min(255, Math.round(c[k])));
        mean[k] += rgba[at + k];
      }
      rgba[at + 3] = 255;
    }
  const data = encodePng(SIZE, SIZE, rgba);
  if (data.length > 512 * 1024) throw new Error(`${name} exceeds asset budget`);
  writeFileSync(resolve(root, `${name}.png`), data);
  const entry = {
    name,
    file: `${name}.png`,
    width: SIZE,
    height: SIZE,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    generator: "tools/make-surfaces.ts",
  };
  const index = manifest.assets.findIndex((a: { file: string }) => a.file === entry.file);
  if (index >= 0) manifest.assets[index] = entry;
  else manifest.assets.push(entry);
  console.log(
    name,
    data.length,
    "bytes; mean",
    mean.map((n) => Math.round(n / (SIZE * SIZE))),
  );
}
function asphalt(x: number, y: number) {
  const cloud = noise(x, y, 4, 42) - 0.5;
  const grit = noise(x, y, 128, 73) - 0.5;
  const grain = hash(x, y, 12) - 0.5;
  const pebble = hash(x, y, 83) > 0.975 ? 19 : 0;
  return 86 + cloud * 12 + grit * 18 + grain * 10 + pebble;
}
write("asphalt", (x, y) => {
  const v = asphalt(x, y);
  return [v, v + 1, v + 4];
});
write("asphalt_detail", (x, y) => {
  const grain = noise(x, y, 128, 73);
  return [100 + grain * 70, 205 + noise(x, y, 8, 55) * 44, 0];
});
function paving(x: number, y: number) {
  const row = Math.floor(y / 128);
  const sx = (x + (row % 2) * 64) % SIZE;
  const col = Math.floor(sx / 128);
  const lx = sx % 128,
    ly = y % 128;
  const edge = Math.min(lx, 128 - lx, ly, 128 - ly);
  const chip = noise(x, y, 64, 13) * 2.2;
  const joint = edge < 1.2 + chip;
  const bevel = edge < 4 + chip;
  const tone = (hash(col, row, 7) - 0.5) * 25;
  const stain = (noise(x, y, 8, 34) - 0.5) * 31;
  const grit = (hash(x, y, 6) - 0.5) * 10;
  const v = joint ? 84 + grit : 174 + tone + stain + grit + (bevel ? 9 : 0);
  const moss = joint && noise(x, y, 16, 4) > 0.54;
  return { v, moss, joint, bevel };
}
write("sidewalk", (x, y) => {
  const { v, moss } = paving(x, y);
  return moss ? [v * 0.76, v * 0.9, v * 0.55] : [v + 2, v + 1, v - 2];
});
write("sidewalk_detail", (x, y) => {
  const p = paving(x, y);
  return [p.joint ? 55 : p.bevel ? 160 : 175, 235, 0];
});
write("grass", (x, y) => {
  const n = noise(x, y, 6, 22),
    clump = noise(x, y, 48, 67),
    grit = hash(x, y, 89);
  return [63 + 20 * n + 18 * clump + 12 * grit, 78 + 19 * n + 19 * clump + 10 * grit, 32 + 10 * n + 10 * clump + 6 * grit];
});
// Roofing felt: staggered rolls, overlap seams and fine mineral grit.
function roofing(x: number, y: number) {
  const row = Math.floor(y / 64);
  const sx = (x + (row % 2) * 128) % 256;
  const seam = y % 64 < 2 || sx < 2;
  const patch = Math.floor(sx / 64) === 1 && row === 3;
  const grain = (hash(x, y, 107) - 0.5) * 16;
  const dirt = (noise(x, y, 8, 111) - 0.5) * 17;
  const v = (seam ? 102 : patch ? 119 : 137) + grain + dirt;
  return { v, seam };
}
write("roof", (x, y) => {
  const { v } = roofing(x, y);
  return [v + 2, v + 1, v];
});
write("roof_detail", (x, y) => [roofing(x, y).seam ? 155 : 128, 220 + noise(x, y, 8, 111) * 25, 0]);
writeFileSync(resolve(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
