/**
 * Runs a headless game with a simple scripted player and prints a report.
 * Usage: pnpm sim [seed] [days]
 */
import { createSimulation, getReport } from "../packages/core/src";
import { autoplay } from "../packages/core/tests/autoplay";

const seed = Number(process.argv[2] ?? 12345);
const days = Number(process.argv[3] ?? 6);
const sim = createSimulation({ seed });
const t0 = performance.now();
autoplay(sim, days);
const report = getReport(sim);
console.log(JSON.stringify({ seed, wallMs: Math.round(performance.now() - t0), ...report }, null, 2));
const alerts = sim.state.log.slice(-25).map((l) => `${l.tick} ${l.key} ${JSON.stringify(l.params)}`);
console.log(alerts.join("\n"));
