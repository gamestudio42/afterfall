// Copies the built web game next to the Electron main process and drops web-only analytics.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripDesktopAnalytics } from "./analytics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, "..", "..", "web", "dist");
const to = path.join(here, "..", "game");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });

const indexPath = path.join(to, "index.html");
const stripped = stripDesktopAnalytics(readFileSync(indexPath, "utf8"));
if (/gc\.zgo\.at|data-goatcounter/i.test(stripped)) {
  console.error("desktop index.html still contains GoatCounter; refusing to package remote analytics");
  process.exit(1);
}
writeFileSync(indexPath, stripped);
console.log(`copied ${from} -> ${to}`);
