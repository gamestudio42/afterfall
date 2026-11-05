import { createSimulation } from "../packages/core/src";
import { placeProps } from "../packages/renderer/src/props";

const sim = createSimulation({ seed: 4242 });
const byKind = placeProps(sim.city, sim.grid, sim.city.seed ?? 1);
let total = 0;
for (const [kind, list] of byKind) {
  console.log(`${kind.padEnd(9)} ${list.length}`);
  total += list.length;
}
console.log(`total ${total} props on ${sim.city.blocksX}x${sim.city.blocksY} blocks`);
