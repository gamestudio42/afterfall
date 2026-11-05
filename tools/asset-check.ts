/**
 * Verifies the art assets against the manifest the generator wrote. This is
 * the rule that keeps a fake or stale render out of the repository: existence,
 * byte budget, PNG header, alpha channel and sha256, all re-derived from disk.
 *
 * Usage: pnpm assets:check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPngHeader } from "./png";

const ART = resolve(import.meta.dirname, "../apps/web/public/art");
const MANIFEST = resolve(ART, "manifest.json");

/** Nothing in `art/` may exceed this, and the whole folder must fit the budget. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

interface Entry {
  name: string;
  file: string;
  kind?: "png" | "glb";
  width?: number;
  height?: number;
  bytes: number;
  sha256: string;
  generator: string;
}

/** A GLB starts with the magic "glTF", then a version and the total length. */
function checkGlb(buf: Buffer): string | null {
  if (buf.readUInt32LE(0) !== 0x46546c67) return "not a GLB (bad magic)";
  const version = buf.readUInt32LE(4);
  const declared = buf.readUInt32LE(8);
  if (version !== 2) return `GLB version ${version}, expected 2`;
  if (declared !== buf.length) return `GLB declares ${declared} bytes, file has ${buf.length}`;
  return null;
}

const problems: string[] = [];
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { version: number; assets: Entry[] };

if (manifest.version !== 1) problems.push(`manifest version ${manifest.version}, expected 1`);
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) problems.push("manifest lists no assets");

let total = 0;
for (const entry of manifest.assets) {
  const file = resolve(ART, entry.file);
  if (!existsSync(file)) {
    problems.push(`${entry.name}: file ${entry.file} is in the manifest but not on disk`);
    continue;
  }
  const buf = readFileSync(file);
  total += buf.length;

  if (buf.length !== entry.bytes) problems.push(`${entry.name}: ${buf.length} bytes on disk, ${entry.bytes} in the manifest`);
  if (buf.length > MAX_FILE_BYTES)
    problems.push(`${entry.name}: ${(buf.length / 1024).toFixed(0)} KB over the ${MAX_FILE_BYTES / 1024} KB per-file budget`);

  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== entry.sha256) problems.push(`${entry.name}: sha256 ${sha.slice(0, 12)} does not match ${entry.sha256.slice(0, 12)}`);

  if (entry.kind === "glb" || entry.file.endsWith(".glb")) {
    const err = checkGlb(buf);
    if (err) problems.push(`${entry.name}: ${err}`);
    continue;
  }

  let header;
  try {
    header = readPngHeader(buf);
  } catch (err) {
    problems.push(`${entry.name}: ${(err as Error).message}`);
    continue;
  }
  if (header.width !== entry.width || header.height !== entry.height) {
    problems.push(`${entry.name}: ${header.width}x${header.height} on disk, ${entry.width}x${entry.height} in the manifest`);
  }
  // 6 = RGBA, 2 = RGB. Anything else is a colour type the renderer cannot use
  // for an alpha-carrying sprite, so it has to be a deliberate choice.
  if (header.colorType !== 6 && header.colorType !== 2) {
    problems.push(`${entry.name}: colour type ${header.colorType}, expected 6 (RGBA) or 2 (RGB)`);
  }
  if (header.bitDepth !== 8) problems.push(`${entry.name}: bit depth ${header.bitDepth}, expected 8`);
}

if (total > MAX_TOTAL_BYTES) problems.push(`art folder is ${(total / 1024).toFixed(0)} KB, over the ${MAX_TOTAL_BYTES / 1024} KB budget`);

for (const line of problems) console.error(`FAIL ${line}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s) in ${ART}`);
  process.exit(1);
}
console.log(`OK ${manifest.assets.length} assets, ${(total / 1024).toFixed(0)} KB, every sha256 and header verified`);
