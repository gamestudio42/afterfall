import { TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick } from "@afterfall/shared";
import type { Simulation } from "../src";

/** Picks a central, reasonably large building as headquarters. */
export function pickBase(sim: Simulation): number {
  const cx = sim.city.width / 2;
  const cy = sim.city.height / 2;
  let best = 0;
  let bestScore = -Infinity;
  for (const b of sim.city.buildings) {
    const area = b.rect.w * b.rect.h;
    const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
    const score = Math.min(area, 500) / 10 - d / 4 + (b.type === "school" || b.type === "warehouse" ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = b.index;
    }
  }
  return best;
}

/**
 * A scripted player that exercises the main loop: scavenges the nearest
 * buildings each morning, converts a shelter, rings the base with towers,
 * and resolves events. Used by balance and regression tests.
 */
export function autoplay(sim: Simulation, days: number, onTick?: (sim: Simulation) => void): void {
  if (sim.state.hq < 0) {
    sim.enqueue({ type: "setBase", building: pickBase(sim) });
    sim.tick();
    onTick?.(sim);
  }
  const end = sim.state.tick + Math.round(days * TICKS_PER_DAY);
  let builtDefenses = false;
  let converted = false;
  while (sim.state.tick < end && !(sim.state.outcome && sim.state.outcome.type === "defeat")) {
    const clock = clockFromTick(sim.state.tick);
    if (sim.state.pendingEvent) sim.enqueue({ type: "resolveEvent", choice: 0 });
    if (sim.state.tick % (TICKS_PER_GAME_MINUTE * 30) === 0 && clock.hour >= 7 && clock.hour < 15) {
      const hq = sim.hqEntrance();
      const idle = [...sim.survivors()].filter((e) => e.survivor.activity.type === "idle" && e.health!.hp > 50);
      const armed = idle.filter((e) => e.survivor.weapon !== "crowbar");
      const scouts = armed.length > 0 ? [armed[0], ...idle.filter((e) => e !== armed[0]).slice(0, 2)] : [];
      if (scouts.length > 0) {
        const target = sim.state.buildings
          .filter((b) => b.fn === "none" && b.task < 0 && b.searchProgress < b.searchTotal)
          .map((b) => ({ b, d: Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (target) sim.enqueue({ type: "scavenge", units: scouts.slice(0, 3).map((e) => e.id), building: target.b.index });
      }
    }
    if (!converted && clock.day >= 1 && clock.hour === 10) {
      const hq = sim.hqEntrance();
      const near = sim.state.buildings
        .filter((b) => b.fn === "none" && b.hiddenInfected === 0 && b.searchProgress >= b.searchTotal)
        .sort((a, b) =>
          Math.hypot(sim.city.buildings[a.index].entrance.x - hq.x, sim.city.buildings[a.index].entrance.y - hq.y) -
          Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y))[0];
      if (near) {
        sim.enqueue({ type: "convert", building: near.index, fn: "shelter" });
        converted = true;
      }
    }
    if (!builtDefenses && sim.state.tick > 20) {
      const hqDef = sim.city.buildings[sim.state.hq];
      const g = sim.grid;
      const cx = Math.floor(hqDef.entrance.x / g.cell);
      const cy = Math.floor(hqDef.entrance.y / g.cell);
      const dy = hqDef.facing.y > 0 ? 3 : -5;
      sim.enqueue({ type: "placeStructures", kind: "tower", cells: [[cx - 4, cy + dy], [cx + 3, cy + dy]] });
      builtDefenses = true;
    }
    sim.tick();
    onTick?.(sim);
  }
}
