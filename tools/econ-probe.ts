/**
 * Probe: proves the bot with `economy` actually builds a farm, a well and a
 * bed building, instead of assuming "economy on" means something.
 */
import { createSimulation } from "../packages/core/src";
import { autoplay } from "../packages/core/tests/autoplay";

for (const seed of [1, 2, 3, 5, 8]) {
  for (const economy of [false, true]) {
    const sim = createSimulation({ seed });
    autoplay(sim, 6, undefined, { fortify: true, craft: economy, economy });
    const structures = [...sim.state.entities.values()].filter((e) => e.structure);
    const count = (kind: string) => structures.filter((e) => e.structure!.kind === kind && e.structure!.built).length;
    const beds = sim.state.buildings.reduce((n, b) => n + b.beds, 0);
    const tasks = [...sim.state.tasks.values()].filter((t) => t.status !== "completed");
    console.log(
      `seed ${seed} economy=${economy ? "on " : "off"} farms=${count("farm")} wells=${count("well")} ` +
        `beds=${beds.toFixed(1)} survivors=${sim.survivorCount()} ` +
        `open_tasks=${tasks.map((t) => t.type).join("|") || "-"} ` +
        `outcome=${sim.state.outcome?.type ?? "running"}`,
    );
  }
}
