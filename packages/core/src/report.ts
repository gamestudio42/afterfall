import type { Simulation } from "./simulation";

export interface SimulationReport {
  day: number;
  tick: number;
  survivorsAlive: number;
  survivorsLost: number;
  survivorsJoined: number;
  infectedAlive: number;
  infectedKilled: number;
  structuresBuilt: number;
  buildingsSearched: number;
  resourcesProduced: Record<string, number>;
  resourcesConsumed: Record<string, number>;
  stock: Record<string, number>;
  eventsOccurred: number;
  hordesSpawned: number;
  navigationFailures: number;
  averageTickMs: number;
  hqHp: number;
  outcome: string | null;
}

export function getReport(sim: Simulation): SimulationReport {
  const st = sim.state;
  let infected = 0;
  for (const _ of sim.infected()) infected++;
  const round = (b: Record<string, number | undefined>) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round((v ?? 0) * 10) / 10]));
  return {
    day: sim.clock.day,
    tick: st.tick,
    survivorsAlive: sim.survivorCount(),
    survivorsLost: st.stats.survivorsLost,
    survivorsJoined: st.stats.survivorsJoined,
    infectedAlive: infected,
    infectedKilled: st.stats.infectedKilled,
    structuresBuilt: st.stats.structuresBuilt,
    buildingsSearched: st.stats.buildingsSearched,
    resourcesProduced: round(st.stats.produced),
    resourcesConsumed: round(st.stats.consumed),
    stock: round(sim.totals()),
    eventsOccurred: st.stats.eventsOccurred,
    hordesSpawned: st.stats.hordesSpawned,
    navigationFailures: st.stats.navFailures,
    averageTickMs: Math.round(sim.tickMs * 1000) / 1000,
    hqHp: sim.hqBuilding?.hp ?? 0,
    outcome: st.outcome ? `${st.outcome.type}:${st.outcome.reason}` : null,
  };
}
