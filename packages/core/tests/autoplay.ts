import { TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import type { Simulation } from "../src";

/**
 * Picks a central, reasonably large building as headquarters. A player who
 * plans to wall the base in prefers a compact building (smaller maxArea).
 */
export function pickBase(sim: Simulation, maxArea = 500): number {
  const cx = sim.city.width / 2;
  const cy = sim.city.height / 2;
  let best = 0;
  let bestScore = -Infinity;
  for (const b of sim.city.buildings) {
    const area = b.rect.w * b.rect.h;
    if (area > maxArea * 1.6) continue;
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
export interface AutoplayOptions {
  /** Rings the headquarters with a wall line and a gate on day one. */
  fortify?: boolean;
}

export function autoplay(sim: Simulation, days: number, onTick?: (sim: Simulation) => void, options: AutoplayOptions = {}): void {
  if (sim.state.hq < 0) {
    sim.enqueue({ type: "setBase", building: pickBase(sim, options.fortify ? 220 : 500) });
    sim.tick();
    onTick?.(sim);
  }
  const end = sim.state.tick + Math.round(days * TICKS_PER_DAY);
  let builtDefenses = false;
  let converted = false;
  let fortified = !options.fortify;
  while (sim.state.tick < end && !(sim.state.outcome && sim.state.outcome.type === "defeat")) {
    const clock = clockFromTick(sim.state.tick);
    if (sim.state.pendingEvent) sim.enqueue({ type: "resolveEvent", choice: 0 });
    if (sim.state.tick % (TICKS_PER_GAME_MINUTE * 30) === 0 && clock.hour >= 7 && clock.hour < 15) {
      const hq = sim.hqEntrance();
      const idle = [...sim.survivors()].filter((e) => e.survivor.activity.type === "idle" && e.health!.hp > 50);
      const armed = idle.filter((e) => e.survivor.weapon !== "crowbar");
      const scouts = armed.length > 0 ? [armed[0], ...idle.filter((e) => e !== armed[0]).slice(0, 2)] : [];
      if (scouts.length > 0) {
        // Like a player reading the danger overlay: avoid nests the party cannot clear.
        const maxDanger = armed.length * 2;
        const target = sim.state.buildings
          .filter((b) => b.fn === "none" && b.task < 0 && b.searchProgress < b.searchTotal && b.hiddenInfected <= maxDanger)
          .map((b) => ({
            b,
            d:
              Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y) +
              b.hiddenInfected * 25,
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (target) sim.enqueue({ type: "scavenge", units: scouts.slice(0, 3).map((e) => e.id), building: target.b.index });
      }
    }
    if (!converted && clock.day >= 1 && clock.hour === 10) {
      const hq = sim.hqEntrance();
      const near = sim.state.buildings
        .filter((b) => b.fn === "none" && b.hiddenInfected === 0 && b.searchProgress >= b.searchTotal)
        .sort(
          (a, b) =>
            Math.hypot(sim.city.buildings[a.index].entrance.x - hq.x, sim.city.buildings[a.index].entrance.y - hq.y) -
            Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y),
        )[0];
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
      sim.enqueue({
        type: "placeStructures",
        kind: "tower",
        cells: [
          [cx - 4, cy + dy],
          [cx + 3, cy + dy],
        ],
      });
      builtDefenses = true;
    }
    if (!fortified && sim.state.tick > 40) {
      const ring = fortRing(sim);
      if (ring) {
        sim.enqueue({ type: "placeStructures", kind: "gate", cells: [ring.gate] });
        sim.enqueue({ type: "placeStructures", kind: "wall", cells: ring.walls });
      }
      fortified = true;
    }
    sim.tick();
    onTick?.(sim);
  }
}

/**
 * Finds a rectangular wall ring around the headquarters that does not
 * cross any building entrance, preferring the one needing the fewest
 * walls. Building cells on the ring close it for free. The gate sits on
 * the ring cell closest to the HQ door.
 */
export function fortRing(sim: Simulation): { walls: [number, number][]; gate: [number, number] } | null {
  const g = sim.grid;
  const b = sim.city.buildings[sim.state.hq];
  const entrances = new Set(sim.city.buildings.map((o) => g.cellOf(o.entrance.x, o.entrance.y)));
  let best: { walls: [number, number][]; gate: [number, number] } | null = null;
  for (let m = 2; m <= 6; m++) {
    const x0 = Math.floor(b.rect.x / g.cell) - m;
    const y0 = Math.floor(b.rect.y / g.cell) - m;
    const x1 = Math.ceil((b.rect.x + b.rect.w) / g.cell) + m - 1;
    const y1 = Math.ceil((b.rect.y + b.rect.h) / g.cell) + m - 1;
    if (!g.inBounds(x0, y0) || !g.inBounds(x1, y1)) continue;
    const cells: [number, number][] = [];
    let blocked = false;
    for (let y = y0; y <= y1 && !blocked; y++)
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
        const i = g.index(x, y);
        if (entrances.has(i)) {
          blocked = true;
          break;
        }
        if (g.kind[i] === CellKind.Free && g.structureAt[i] === -1) cells.push([x, y]);
        else if (g.kind[i] !== CellKind.Building) blocked = true;
      }
    if (blocked || cells.length === 0) continue;
    const door = b.entrance;
    let gi = 0;
    let gd = Infinity;
    cells.forEach(([x, y], k) => {
      const d = Math.hypot((x + 0.5) * g.cell - door.x, (y + 0.5) * g.cell - door.y);
      if (d < gd) {
        gd = d;
        gi = k;
      }
    });
    const gate = cells[gi];
    const walls = cells.filter((_, k) => k !== gi);
    if (!best || walls.length < best.walls.length) best = { walls, gate };
  }
  return best;
}
