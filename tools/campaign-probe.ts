/**
 * Day-by-day trace of one seed under the research bot: what the horde costs, what
 * the economy produces, and how far the cure got. Usage:
 *   pnpm exec tsx tools/campaign-probe.ts <seed> [days] [research|plain]
 */
import { createSimulation } from "../packages/core/src";
import { autoplay } from "../packages/core/tests/autoplay";

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 14);
const mode = process.argv[4] ?? "research";
const research = mode !== "plain";
const full = mode === "full";

const sim = createSimulation({ seed });
const rows: string[] = [];
let lastDay = 0;

autoplay(
  sim,
  days,
  (s) => {
    const day = s.clock.day;
    if (day === lastDay) return;
    lastDay = day;
    const t = s.totals();
    const r = s.state.research;
    const labs = s.state.buildings.filter((b) => b.fn === "lab" && b.hp > 0).length;
    rows.push(
      [
        `d${day}`,
        `pop${s.survivorCount()}`,
        `k${s.state.stats.infectedKilled}`,
        `food${Math.round(t.food ?? 0)}`,
        `med${Math.round((t.medicine ?? 0) * 10) / 10}`,
        `ammo${Math.round(t.ammo ?? 0)}`,
        `wood${Math.round(t.wood ?? 0)}`,
        `metal${Math.round(t.metal ?? 0)}`,
        `mp${Math.round(s.state.stats.produced.metal ?? 0)}`,
        `ap${Math.round(s.state.stats.produced.ammo ?? 0)}`,
        `wf${s.state.buildings.filter((b) => b.fn === "workshop").length}`,
        `tasks${[...s.state.tasks.values()].map((x) => `${x.type}:${x.status}`).join("|") || "-"}`,
        `hq${Math.round(s.hqBuilding?.hp ?? 0)}`,
        `pts${Math.round(r.points)}`,
        `tech${r.unlocked.length}`,
        `labs${labs}`,
        `cure${r.cure.started ? `${r.cure.progress}/3` : "-"}`,
      ].join(" "),
    );
  },
  { fortify: full, craft: full, economy: full, research },
);

console.log(`seed ${seed} ${mode} outcome=${JSON.stringify(sim.state.outcome)}`);
console.log(rows.join("\n"));
