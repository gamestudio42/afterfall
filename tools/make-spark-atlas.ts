/**
 * Packs a rendered spark sequence into the flipbook atlas the renderer plays.
 *
 * The source is the canonical EffectCraft render (`hit_sparks_final`): a 30
 * frame, 400x400 WebM plus its alpha pass, because the video stream carries no
 * alpha of its own. Decoding stays in ffmpeg; this script only resamples, packs
 * and premultiplies.
 *
 * Usage (needs ffmpeg on PATH):
 *   ffmpeg -i hit_sparks_final.webm -pix_fmt rgb24 -f rawvideo /tmp/final_rgb.raw
 *   pnpm exec tsx tools/make-spark-atlas.ts /tmp/final_rgb.raw a_final.raw
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePng } from "./png";

const SRC = 400; // source frame edge
const CELL = 128; // atlas cell edge
const COLS = 6;
const ROWS = 5; // 30 frames
const FRAMES = COLS * ROWS;

const rgbPath = process.argv[2];
const alphaPath = process.argv[3];
if (!rgbPath || !alphaPath) {
  console.error("usage: make-spark-atlas.ts <rgb.raw> <alpha.raw>");
  process.exit(2);
}
for (const p of [rgbPath, alphaPath]) {
  if (!existsSync(p)) {
    console.error(`missing ${p}`);
    process.exit(2);
  }
}

const rgb = readFileSync(rgbPath);
const alpha = readFileSync(alphaPath);
const frameBytes = SRC * SRC;
if (rgb.length !== frameBytes * 3 * FRAMES) throw new Error(`rgb is ${rgb.length} bytes, expected ${frameBytes * 3 * FRAMES}`);
if (alpha.length !== frameBytes * FRAMES) throw new Error(`alpha is ${alpha.length} bytes, expected ${frameBytes * FRAMES}`);

const W = COLS * CELL;
const H = ROWS * CELL;
const out = new Uint8Array(W * H * 4);
const step = SRC / CELL; // 3.125: box average a block per output pixel

for (let f = 0; f < FRAMES; f++) {
  const ox = (f % COLS) * CELL;
  const oy = Math.floor(f / COLS) * CELL;
  for (let cy = 0; cy < CELL; cy++) {
    for (let cx = 0; cx < CELL; cx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const x0 = Math.floor(cx * step);
      const y0 = Math.floor(cy * step);
      const x1 = Math.min(SRC, Math.floor((cx + 1) * step) + 1);
      const y1 = Math.min(SRC, Math.floor((cy + 1) * step) + 1);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = sy * SRC + sx;
          const base = (f * frameBytes + i) * 3;
          r += rgb[base];
          g += rgb[base + 1];
          b += rgb[base + 2];
          a += alpha[f * frameBytes + i];
          n++;
        }
      }
      const al = a / n / 255;
      const di = ((oy + cy) * W + ox + cx) * 4;
      // Premultiplied, because the effects blend additively: colour scaled by
      // alpha is exactly what an additive pass wants and it kills the halo.
      out[di] = Math.round((r / n) * al);
      out[di + 1] = Math.round((g / n) * al);
      out[di + 2] = Math.round((b / n) * al);
      out[di + 3] = Math.round(al * 255);
    }
  }
}

const png = encodePng(W, H, out);
const file = resolve(import.meta.dirname, "../apps/web/public/art/spark_atlas.png");
writeFileSync(file, png);

const entry = {
  name: "spark_atlas",
  file: "spark_atlas.png",
  width: W,
  height: H,
  bytes: png.length,
  sha256: createHash("sha256").update(png).digest("hex"),
  generator: "EffectCraft hit_sparks_final + tools/make-spark-atlas.ts",
  grid: { cols: COLS, rows: ROWS, frames: FRAMES, cell: CELL },
};

const manifestFile = resolve(import.meta.dirname, "../apps/web/public/art/manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { version: number; assets: Record<string, unknown>[] };
manifest.assets = [...manifest.assets.filter((a) => a.name !== entry.name), entry];
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${file}  ${W}x${H}  ${(png.length / 1024).toFixed(0)} KB  ${FRAMES} frames`);
