/**
 * Verifies the art assets against the manifest the generator wrote. This is
 * the rule that keeps a fake or stale render out of the repository: existence,
 * byte budget, PNG or JPEG header, alpha channel and sha256, all re-derived
 * from disk.
 *
 * The budget is for art that streams in after the first frame: every map
 * loads asynchronously and the renderer keeps its flat colours until it lands,
 * so this number does not delay the start of a game. The initial payload (the
 * JS bundle) has its own ceiling in docs/ROADMAP.md.
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
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

interface Entry {
  name: string;
  file: string;
  kind?: "png" | "jpg" | "glb";
  width?: number;
  height?: number;
  bytes: number;
  sha256: string;
  generator: string;
}

/** Width and height from a baseline or progressive JPEG's SOF segment. */
function readJpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG (bad SOI)");
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`JPEG marker expected at ${i}`);
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("JPEG has no SOF segment");
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

  if (entry.kind === "jpg" || entry.file.endsWith(".jpg")) {
    try {
      const size = readJpegSize(buf);
      if (size.width !== entry.width || size.height !== entry.height) {
        problems.push(`${entry.name}: ${size.width}x${size.height} on disk, ${entry.width}x${entry.height} in the manifest`);
      }
    } catch (err) {
      problems.push(`${entry.name}: ${(err as Error).message}`);
    }
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
