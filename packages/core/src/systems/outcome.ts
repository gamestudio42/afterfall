import { BALANCE } from "@afterfall/content";
import { tickAt } from "@afterfall/shared";
import type { Simulation } from "../simulation";

export function outcomeSystem(sim: Simulation): void {
  const st = sim.state;
  if (!st.started || st.outcome) return;
  const hq = sim.hqBuilding;
  if (hq && hq.hp <= 0) {
    st.outcome = { type: "defeat", reason: "hqDestroyed", tick: st.tick };
    sim.alert("alert.defeat", {}, "danger");
    return;
  }
  if (sim.survivorCount() === 0) {
    st.outcome = { type: "defeat", reason: "allDead", tick: st.tick };
    sim.alert("alert.defeat", {}, "danger");
    return;
  }
  if (st.tick >= tickAt(BALANCE.nightsToWin + 1, 6)) {
    st.outcome = { type: "victory", reason: "survived", tick: st.tick };
    sim.alert("alert.victory", {}, "success");
  }
}
