/**
 * Ships the main menu's backdrop: the HUD-less night capture written by
 * `tests/e2e/atmosphere-shot.spec.ts`, scaled to 1600 px and stored as JPEG,
 * and recorded in the art manifest.
 *
 * Usage (needs ffmpeg on PATH):
 *   ATMOS_SHOT=1 pnpm test:e2e tests/e2e/atmosphere-shot.spec.ts
 *   pnpm exec tsx tools/pack-menu-backdrop.ts
 *   pnpm exec prettier --write apps/web/public/art/manifest.json
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(import.meta.dirname, "../docs/art/menu_backdrop.png");
if (!existsSync(src)) throw new Error(`missing ${src}: run the atmosphere capture first`);
const ART = resolve(import.meta.dirname, "../apps/web/public/art");
const out = resolve(ART, "menu_bg.jpg");
const WIDTH = 1600;

// The menu darkens it and puts a card over it, so a strong compression is invisible.
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `scale=${WIDTH}:-2`, "-q:v", "6", out]);
const buf = readFileSync(out);
const [width, height] = execFileSync(
  "ffprobe",
  ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out],
  { encoding: "utf8" },
)
  .trim()
  .split(",")
  .map(Number);

const entry = {
  name: "menu_bg",
  file: "menu_bg.jpg",
  kind: "jpg",
  width,
  height,
  bytes: buf.length,
  sha256: createHash("sha256").update(buf).digest("hex"),
  generator: "tests/e2e/atmosphere-shot.spec.ts + tools/pack-menu-backdrop.ts",
};
const manifestFile = resolve(ART, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { version: number; assets: Record<string, unknown>[] };
manifest.assets = [...manifest.assets.filter((a) => a.name !== entry.name), entry];
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`menu_bg.jpg  ${width}x${height}  ${(buf.length / 1024).toFixed(1)} KB`);
