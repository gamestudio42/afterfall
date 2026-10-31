/**
 * Plays many seeds with both scripted players and prints win rates.
 * Usage: pnpm sweep [seeds=20] [firstSeed=1] [open|fort]
 */
import { createSimulation, getReport } from "../packages/core/src";
import { autoplay } from "../packages/core/tests/autoplay";

const count = Number(process.argv[2] ?? 20);
const first = Number(process.argv[3] ?? 1);
const modes = process.argv[4] === "fort" ? [true] : process.argv[4] === "open" ? [false] : [false, true];

for (const fortify of modes) {
  let wins = 0;
  const rows: string[] = [];
  for (let seed = first; seed < first + count; seed++) {
    const sim = createSimulation({ seed });
    autoplay(sim, 6, undefined, { fortify });
    const r = getReport(sim);
    if (r.outcome?.startsWith("victory")) wins++;
    rows.push(
      `${seed}:${r.outcome ?? "-"}@d${r.day} s${r.survivorsAlive} k${r.infectedKilled} w${Math.round(r.stock.wood ?? 0)} a${Math.round(r.stock.ammo ?? 0)} b${r.structuresBuilt}`,
    );
  }
  console.log(`${fortify ? "fort" : "open"} wins ${wins}/${count}`);
  console.log(rows.join("\n"));
}
