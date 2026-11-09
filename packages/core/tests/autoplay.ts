import { TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import { BALANCE, STRUCTURES, TECHS } from "@afterfall/content";
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
  /** Also turns a second building into a workshop, so the ammo recipe runs. */
  craft?: boolean;
  /** Also builds a farm and a well, and converts a second shelter for beds. */
  economy?: boolean;
  /** Also buys research, stands a lab up and runs the cure project. */
  research?: boolean;
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
  let workshop = false;
  let farm = false;
  let well = false;
  let secondShelter = false;
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
    // A second building becomes a workshop: the game itself creates the craft
    // task (metal -> ammo) and keeps it while ammo is below `keepAmmo`, so the
    // bot only has to hand over the building.
    if (options.craft && !workshop && converted && clock.hour >= 11 && clock.hour < 18) {
      const hqW = sim.hqEntrance();
      const nearW = sim.state.buildings
        .filter((b) => b.fn === "none" && b.hiddenInfected === 0 && b.searchProgress >= b.searchTotal)
        .sort(
          (a, b) =>
            Math.hypot(sim.city.buildings[a.index].entrance.x - hqW.x, sim.city.buildings[a.index].entrance.y - hqW.y) -
            Math.hypot(sim.city.buildings[b.index].entrance.x - hqW.x, sim.city.buildings[b.index].entrance.y - hqW.y),
        )[0];
      if (nearW) {
        sim.enqueue({ type: "convert", building: nearW.index, fn: "workshop" });
        workshop = true;
      }
    }
    // Farm and well: the game creates the build task and then the production
    // one; the bot only picks the spot. Without them, any tuning of hunger or
    // water measures the bot. It only plants when there is spare material:
    // queueing without wood leaves the task "blocked" and the base stops
    // building everything else.
    const stock = sim.totals();
    const builtKind = (kind: string) => [...sim.state.entities.values()].some((e) => e.structure?.kind === kind && e.structure.built);
    if (options.economy && !farm && sim.state.tick > 50 && (stock.wood ?? 0) >= 18 && (stock.water ?? 0) >= 8) {
      const cells = freeSpot(sim, "farm");
      if (cells) {
        sim.enqueue({ type: "placeStructures", kind: "farm", cells });
        farm = true;
      }
    }
    if (options.economy && farm && !well && builtKind("farm") && (stock.wood ?? 0) >= 10 && (stock.metal ?? 0) >= 10) {
      const cells = freeSpot(sim, "well");
      if (cells) {
        sim.enqueue({ type: "placeStructures", kind: "well", cells });
        well = true;
      }
    }
    if (options.economy && !secondShelter && clock.day >= 2 && clock.hour === 10 && (stock.wood ?? 0) >= 16) {
      const beds = sim.state.buildings.reduce((n, b) => n + (b.hp > 0 ? b.beds : 0), 0);
      if (beds < sim.survivorCount()) {
        const hqS = sim.hqEntrance();
        const next = sim.state.buildings
          .filter((b) => b.fn === "none" && b.hiddenInfected === 0 && b.searchProgress >= b.searchTotal)
          .sort(
            (a, b) =>
              Math.hypot(sim.city.buildings[a.index].entrance.x - hqS.x, sim.city.buildings[a.index].entrance.y - hqS.y) -
              Math.hypot(sim.city.buildings[b.index].entrance.x - hqS.x, sim.city.buildings[b.index].entrance.y - hqS.y),
          )[0];
        if (next) {
          sim.enqueue({ type: "convert", building: next.index, fn: "shelter" });
          secondShelter = true;
        }
      }
    }
    // Research: buy in a fixed order that reflects what a player needs first —
    // medicine, then the lab and the cure, then the economy and the walls.
    if (options.research) {
      const order = [
        "serum",
        "lab",
        "cure",
        "scaffolding",
        "preserves",
        "armory",
        "forge",
        "cistern",
        "marksmanship",
        "rations",
        "salvage",
        "floodlights",
      ] as const;
      for (const id of order) {
        if (sim.hasTech(id)) continue;
        const def = TECHS[id];
        if (def.requires && !sim.hasTech(def.requires)) continue;
        if (sim.state.research.points >= def.cost) sim.enqueue({ type: "unlockTech", tech: id });
        break;
      }
      // One lab, as close to the base as a cleared building allows.
      // Not on day one: the lab costs metal and medicine the first nights need.
      if (
        !sim.standingLab() &&
        clock.day >= 3 &&
        clock.hour >= 9 &&
        clock.hour < 16 &&
        (sim.totals().wood ?? 0) >= 20 &&
        (sim.totals().metal ?? 0) >= 14
      ) {
        const hqR = sim.hqEntrance();
        const near = sim.state.buildings
          .filter(
            (b) =>
              b.fn === "none" &&
              b.hiddenInfected === 0 &&
              b.searchProgress >= b.searchTotal &&
              sim.city.buildings[b.index].type !== "house",
          )
          .sort(
            (a, b) =>
              Math.hypot(sim.city.buildings[a.index].entrance.x - hqR.x, sim.city.buildings[a.index].entrance.y - hqR.y) -
              Math.hypot(sim.city.buildings[b.index].entrance.x - hqR.x, sim.city.buildings[b.index].entrance.y - hqR.y),
          )[0];
        if (near) sim.enqueue({ type: "convert", building: near.index, fn: "lab" });
      }
      // The cure, as soon as it is affordable.
      if (
        sim.hasTech("cure") &&
        !sim.state.research.cure.started &&
        sim.standingLab() &&
        sim.state.research.points >= BALANCE.research.cureResearch &&
        sim.totals().medicine >= BALANCE.research.cureMedicine
      ) {
        sim.enqueue({ type: "startCure" });
      }
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
 * Finds a free corner near the base for a structure, without covering a
 * building door. Returns the anchor cells (top-left corner) or null.
 */
export function freeSpot(sim: Simulation, kind: "farm" | "well" | "tower" | "wall" | "gate"): [number, number][] | null {
  const g = sim.grid;
  const def = STRUCTURES[kind];
  const b = sim.city.buildings[sim.state.hq];
  if (!b) return null;
  const cx = Math.floor(b.entrance.x / g.cell);
  const cy = Math.floor(b.entrance.y / g.cell);
  const entrances = new Set(sim.city.buildings.map((o) => g.cellOf(o.entrance.x, o.entrance.y)));
  for (let ring = 2; ring <= 14; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = cx + dx;
        const y = cy + dy;
        const fp = g.footprint(x, y, def.size);
        if (fp.length !== def.size * def.size) continue;
        if (!fp.every((i) => g.kind[i] === CellKind.Free && g.structureAt[i] === -1)) continue;
        if (def.solid && fp.some((i) => entrances.has(i))) continue;
        return [[x, y]];
      }
    }
  }
  return null;
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
