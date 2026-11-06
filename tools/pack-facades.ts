/**
 * Ships the facade and roof bake (`tools/blender/facades.py`) into the art
 * folder as JPEG and records each file in the manifest.
 *
 * The bake is RGB with no alpha, so JPEG costs a quarter of the PNG. The
 * lit-window masks are stored as grey JPEGs; their soft edges are harmless,
 * because they only gate a glow.
 *
 * Usage (needs ffmpeg on PATH):
 *   blender --background --factory-startup --python tools/blender/facades.py -- <bake_dir> 48
 *   pnpm exec tsx tools/pack-facades.ts <bake_dir>
 *   pnpm exec prettier --write apps/web/public/art/manifest.json
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const bake = process.argv[2];
if (!bake) {
  console.error("usage: pack-facades.ts <bake_dir>");
  process.exit(2);
}

const ART = resolve(import.meta.dirname, "../apps/web/public/art");
const NAMES = [
  "facade_residential",
  "facade_office",
  "facade_industrial",
  "facade_storefront",
  "facade_residential_lit",
  "facade_office_lit",
  "facade_industrial_lit",
  "facade_storefront_lit",
  "roof",
];
const blender = execFileSync("blender", ["--version"], { encoding: "utf8" }).split("\n")[0].trim();

const entries = [];
for (const name of NAMES) {
  const src = resolve(bake, `${name}.png`);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const out = resolve(ART, `${name}.jpg`);
  const mask = name.endsWith("_lit");
  // q 3 keeps the brick and grime; the masks only need their shapes.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-q:v", mask ? "6" : "3", "-pix_fmt", mask ? "gray" : "yuvj444p", out]);
  const buf = readFileSync(out);
  const size = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split(",")
    .map(Number);
  entries.push({
    name,
    file: `${name}.jpg`,
    kind: "jpg",
    width: size[0],
    height: size[1],
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    generator: `${blender} tools/blender/facades.py + tools/pack-facades.ts`,
  });
  console.log(`${name}.jpg  ${size[0]}x${size[1]}  ${(buf.length / 1024).toFixed(1)} KB`);
}

const manifestFile = resolve(ART, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { version: number; assets: Record<string, unknown>[] };
manifest.assets = [...manifest.assets.filter((a) => !NAMES.includes(a.name as string)), ...entries];
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
