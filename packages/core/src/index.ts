export * from "./state";
export * from "./simulation";
export * from "./commands";
export * from "./persistence";
export * from "./report";
export { taskSite, outstanding } from "./systems/tasks";
export { efficiency } from "./systems/util";
export { EVENT_TIMEOUT_TICKS } from "./systems/events";

import { Simulation, type SimulationOptions } from "./simulation";

/** Convenience factory used by tests and the headless runner. */
export function createSimulation(opts: SimulationOptions): Simulation {
  return new Simulation(opts);
}
