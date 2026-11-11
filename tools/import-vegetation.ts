/** Import the selected original Refloreste assets; never modify the source kit. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readPngHeader } from "./png";
const source = process.argv[2];
if (!source) throw new Error("Usage: node --import tsx tools/import-vegetation.ts <Refloreste kit>");
const art = resolve(import.meta.dirname, "../apps/web/public/art");
mkdirSync(resolve(art, "vegetation"), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(art, "manifest.json"), "utf8"));
const files = {
  "manaca.glb": "assets/vegetacao/mata_atlantica/manaca/mata_atlantica_manaca_adulta.glb",
  "pequi.glb": "assets/vegetacao/cerrado/pequi/cerrado_pequi_adulta.glb",
  "dead.glb": "assets/vegetacao/mata_atlantica/manaca/mata_atlantica_manaca_morta.glb",
  "bush.glb": "assets/vegetacao/mata_atlantica/bush/mata_atlantica_bush_adulta.glb",
  "leaf_alpha.png": "textures/leaf_alpha.png",
};
for (const [name, path] of Object.entries(files)) {
  const file = `vegetation/${name}`;
  const data = readFileSync(resolve(source, path));
  if (data.length > 512 * 1024) throw new Error(`${name} exceeds budget`);
  copyFileSync(resolve(source, path), resolve(art, file));
  const size = name.endsWith("png") ? readPngHeader(data) : null;
  const entry = {
    name: `vegetation_${name.split(".")[0]}`,
    file,
    kind: size ? "png" : "glb",
    ...(size ? { width: size.width, height: size.height } : {}),
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    generator: "tools/import-vegetation.ts",
    source: `Refloreste/${path}`,
  };
  const index = manifest.assets.findIndex((a: { file: string }) => a.file === file);
  if (index >= 0) manifest.assets[index] = entry;
  else manifest.assets.push(entry);
}
writeFileSync(resolve(art, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Imported four Refloreste models and their original leaf mask.");
