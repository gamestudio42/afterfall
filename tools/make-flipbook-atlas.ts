/**
 * Packs a rendered RGBA frame sequence into a flipbook atlas and records it in
 * the art manifest.
 *
 * The input is raw RGBA, frames back to back, which keeps PNG decoding in
 * ffmpeg and this script free of a binary dependency. Frames are box-averaged
 * down to the cell size and laid out left to right, top to bottom. RGB stays
 * STRAIGHT (not premultiplied), for the same reason as `make-spark-atlas.ts`:
 * three's additive blend already multiplies the source by alpha.
 *
 * Usage (needs ffmpeg on PATH):
 *   ffmpeg -i frames/f_%05d.png -frames:v 4 -f rawvideo -pix_fmt rgba /tmp/muzzle.raw
 *   pnpm exec tsx tools/make-flipbook-atlas.ts muzzle_atlas /tmp/muzzle.raw \
 *     --src 256 --cell 128 --cols 4 --rows 1 --generator "EffectCraft 0.21.1 muzzle_flash"
 *   pnpm exec prettier --write apps/web/public/art/manifest.json
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { encodePng } from "./png";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    src: { type: "string" },
    cell: { type: "string", default: "128" },
    cols: { type: "string" },
    rows: { type: "string", default: "1" },
    generator: { type: "string" },
  },
});

const [name, rawPath] = positionals;
if (!name || !rawPath || !values.src || !values.cols || !values.generator) {
  console.error("usage: make-flipbook-atlas.ts <name> <frames.rgba.raw> --src N --cols N [--rows N] [--cell N] --generator TEXT");
  process.exit(2);
}
if (!/^[a-z0-9_]+$/.test(name)) {
  console.error(`name must be lowercase letters, digits and underscores, got ${name}`);
  process.exit(2);
}
if (!existsSync(rawPath)) {
  console.error(`missing ${rawPath}`);
  process.exit(2);
}

const SRC = Number(values.src);
const CELL = Number(values.cell);
const COLS = Number(values.cols);
const ROWS = Number(values.rows);
const FRAMES = COLS * ROWS;

const raw = readFileSync(rawPath);
const frameBytes = SRC * SRC * 4;
if (raw.length !== frameBytes * FRAMES) {
  throw new Error(`input is ${raw.length} bytes, expected ${FRAMES} frames of ${SRC}x${SRC} RGBA (${frameBytes * FRAMES})`);
}

const W = COLS * CELL;
const H = ROWS * CELL;
const out = new Uint8Array(W * H * 4);
const step = SRC / CELL;

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
      const x1 = Math.min(SRC, Math.max(x0 + 1, Math.floor((cx + 1) * step)));
      const y1 = Math.min(SRC, Math.max(y0 + 1, Math.floor((cy + 1) * step)));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = f * frameBytes + (sy * SRC + sx) * 4;
          r += raw[i];
          g += raw[i + 1];
          b += raw[i + 2];
          a += raw[i + 3];
          n++;
        }
      }
      const di = ((oy + cy) * W + ox + cx) * 4;
      out[di] = Math.round(r / n);
      out[di + 1] = Math.round(g / n);
      out[di + 2] = Math.round(b / n);
      out[di + 3] = Math.round(a / n);
    }
  }
}

/** Share of each frame's pixels with visible alpha (>= 8), so an empty frame is caught here. */
const coverage: number[] = [];
for (let f = 0; f < FRAMES; f++) {
  const ox = (f % COLS) * CELL;
  const oy = Math.floor(f / COLS) * CELL;
  let visible = 0;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (out[((oy + y) * W + ox + x) * 4 + 3] >= 8) visible++;
  coverage.push(Math.round((visible / (CELL * CELL)) * 10000) / 100);
}
const empty = coverage.findIndex((c) => c === 0);
if (empty >= 0) {
  console.error(`frame ${empty} is empty after packing (coverage ${coverage.join(", ")}%): trim the sequence instead`);
  process.exit(1);
}

const png = encodePng(W, H, out);
const fileName = `${name}.png`;
const file = resolve(import.meta.dirname, "../apps/web/public/art", fileName);
writeFileSync(file, png);

const entry = {
  name,
  file: fileName,
  width: W,
  height: H,
  bytes: png.length,
  sha256: createHash("sha256").update(png).digest("hex"),
  generator: `${values.generator} + tools/make-flipbook-atlas.ts`,
  grid: { cols: COLS, rows: ROWS, frames: FRAMES, cell: CELL },
  coverage,
};

const manifestFile = resolve(import.meta.dirname, "../apps/web/public/art/manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { version: number; assets: Record<string, unknown>[] };
manifest.assets = [...manifest.assets.filter((a) => a.name !== entry.name), entry];
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${file}  ${W}x${H}  ${(png.length / 1024).toFixed(1)} KB  ${FRAMES} frames  coverage ${coverage.join(" / ")}%`);
