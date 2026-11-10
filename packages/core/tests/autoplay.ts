import { TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, clockFromTick } from "@afterfall/shared";
import { CellKind } from "@afterfall/world";
import { BALANCE, BUILDING_FUNCTIONS, RESOURCE_IDS, STRUCTURES, TECHS, type ResourceBag } from "@afterfall/content";
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
  /**
   * Rounds deposited at the headquarters at every dawn. An experiment lever, not a
   * strategy: it answers "would more ammo change the outcome?" without touching the
   * content, so a hypothesis can be dropped before a rule is changed for it.
   */
  ammoSubsidy?: number;
}

/** True when the stock covers the bill plus the reserve. */
function canPay(stock: ResourceBag, cost: ResourceBag, reserve = 0): boolean {
  for (const r of RESOURCE_IDS) {
    const need = (cost[r] ?? 0) + (r === "wood" ? reserve : 0);
    if ((stock[r] ?? 0) < need) return false;
  }
  return true;
}

export function autoplay(sim: Simulation, days: number, onTick?: (sim: Simulation) => void, options: AutoplayOptions = {}): void {
  if (sim.state.hq < 0) {
    sim.enqueue({ type: "setBase", building: pickBase(sim, options.fortify ? 220 : 500) });
    sim.tick();
    onTick?.(sim);
  }
  const end = sim.state.tick + Math.round(days * TICKS_PER_DAY);
  let subsidisedDay = 0;
  let decisionHour = -1;
  let fortified = false;

  const hasFunction = (fn: string) => sim.state.buildings.some((b) => b.fn === fn && b.hp > 0);
  // A conversion that is still being built already counts as taken: without this the bot
  // handed a second building to the same function every hour until the first finished.
  const converting = (fn: string) =>
    [...sim.state.tasks.values()].some((t) => t.type === "convert" && t.convertTo === fn && t.status !== "completed");
  const builtKind = (kind: string) => [...sim.state.entities.values()].some((e) => e.structure?.kind === kind && e.structure.built);
  const placedKind = (kind: string) => [...sim.state.entities.values()].filter((e) => e.structure?.kind === kind).length;

  /** A building this bot can hand over: empty, cleared, searched and not already committed. */
  const spareBuilding = (excludeTypes: string[] = []) => {
    const hq = sim.hqEntrance();
    return sim.state.buildings
      .filter(
        (b) =>
          // `hp` is 0 on every building until a function gives it maxHp, so it cannot be
          // read as "still standing" here: that filter rejected every candidate.
          b.fn === "none" &&
          b.task < 0 &&
          b.hiddenInfected === 0 &&
          b.searchProgress >= b.searchTotal &&
          !excludeTypes.includes(sim.city.buildings[b.index].type),
      )
      .sort(
        (a, b) =>
          Math.hypot(sim.city.buildings[a.index].entrance.x - hq.x, sim.city.buildings[a.index].entrance.y - hq.y) -
          Math.hypot(sim.city.buildings[b.index].entrance.x - hq.x, sim.city.buildings[b.index].entrance.y - hq.y),
      )[0];
  };

  const convert = (fn: "shelter" | "workshop" | "lab", excludeTypes: string[] = []) => {
    const target = spareBuilding(excludeTypes);
    if (!target) return false;
    sim.enqueue({ type: "convert", building: target.index, fn });
    return true;
  };

  while (sim.state.tick < end && !(sim.state.outcome && sim.state.outcome.type === "defeat")) {
    const clock = clockFromTick(sim.state.tick);
    const stock = sim.totals();
    if (options.ammoSubsidy && clock.hour === 6 && clock.day !== subsidisedDay) {
      subsidisedDay = clock.day;
      const hqS = sim.hqEntrance();
      sim.deposit({ ammo: options.ammoSubsidy }, hqS.x, hqS.y);
    }
    if (sim.state.pendingEvent) sim.enqueue({ type: "resolveEvent", choice: 0 });

    // Scavenging, every half hour of daylight.
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

    /**
     * One structural decision per game hour, and only if the stock covers it. The bot used
     * to queue the shelter, the workshop, two towers, a farm and a well inside two game
     * hours with thirty-four wood: every blueprint after the first sat `blocked`, the wood
     * went into tasks that could not finish, and the workshop was never built. A blueprint
     * is created without checking the bill, so the check has to live here.
     */
    if (clock.minute === 0 && clock.hour >= 7 && clock.hour <= 16 && clock.hour !== decisionHour) {
      decisionHour = clock.hour;
      const shelter = hasFunction("shelter") || converting("shelter");
      const workshop = hasFunction("workshop") || converting("workshop");
      // What the plan still owes, held back from walls and towers.
      const reserve = !shelter ? 8 : options.craft && !workshop ? 6 : options.economy && !builtKind("farm") ? 10 : 2;
      // One command per hour, but a step that cannot run must not starve the steps after
      // it: with a strict if/else chain, "no searched building for a shelter yet" also
      // meant no tower, and the settlement entered night two naked.
      // Metal is contested: the workshop turns it into ammo until `keepAmmo`, and every
      // shot spends that ammo. While a metal-hungry structure is still owed, the bot
      // lowers the ceiling the way a player would, or construction never gets its share.
      const owesMetal = !workshop || placedKind("well") === 0 || placedKind("tower") < 2;
      const keep = owesMetal && (stock.metal ?? 0) < 12 ? 20 : BALANCE.policies.keepAmmo;
      if (sim.state.policies.keepAmmo !== keep) sim.enqueue({ type: "setPolicy", policy: { keepAmmo: keep } });
      let acted = false;

      if (!acted && !shelter && canPay(stock, BUILDING_FUNCTIONS.shelter.cost, 0)) {
        acted = convert("shelter");
      }
      if (!acted && shelter && options.craft && !workshop && canPay(stock, BUILDING_FUNCTIONS.workshop.cost, 0)) {
        // Never the building the shelter just took: a conversion on a building with a task
        // is refused silently, and the bot believed the workshop existed for twelve days.
        acted = convert("workshop", ["house"]);
      }
      if (!acted && shelter && options.economy && placedKind("farm") === 0 && canPay(stock, STRUCTURES.farm.cost, 0)) {
        const cells = freeSpot(sim, "farm");
        if (cells) {
          sim.enqueue({ type: "placeStructures", kind: "farm", cells });
          acted = true;
        }
      }
      if (!acted && options.economy && builtKind("farm") && !builtKind("well") && canPay(stock, STRUCTURES.well.cost, 0)) {
        const cells = freeSpot(sim, "well");
        if (cells) {
          sim.enqueue({ type: "placeStructures", kind: "well", cells });
          acted = true;
        }
      }
      // One tower is defence; the second is a luxury that costs the farm its wood.
      const towerCap = options.economy && !builtKind("farm") ? 1 : 2;
      if (!acted && placedKind("tower") < towerCap && canPay(stock, STRUCTURES.tower.cost, reserve)) {
        const hqDef = sim.city.buildings[sim.state.hq];
        const g = sim.grid;
        const cx = Math.floor(hqDef.entrance.x / g.cell);
        const cy = Math.floor(hqDef.entrance.y / g.cell);
        const dy = hqDef.facing.y > 0 ? 3 : -5;
        const first = placedKind("tower") === 0;
        sim.enqueue({ type: "placeStructures", kind: "tower", cells: [first ? [cx - 4, cy + dy] : [cx + 3, cy + dy]] });
        acted = true;
      }
      // Beds before a second body, but only once the farm is standing: a settlement above
      // its bed count sleeps badly, and a settlement without food does not sleep at all.
      if (!acted && options.economy && placedKind("farm") > 0) {
        const beds = sim.state.buildings.reduce((n, b) => n + (b.hp > 0 ? b.beds : 0), 0);
        if (beds < sim.survivorCount() && canPay(stock, BUILDING_FUNCTIONS.shelter.cost, 0)) convert("shelter");
      }
    }

    // The ring, as one blueprint, two minutes in: it is a queue that fills as wood
    // arrives, and every hour it waits is an hour of wall the first night does not get.
    if (!fortified && options.fortify && sim.state.tick > 40) {
      const ring = fortRing(sim);
      if (ring) {
        sim.enqueue({ type: "placeStructures", kind: "gate", cells: [ring.gate] });
        sim.enqueue({ type: "placeStructures", kind: "wall", cells: ring.walls });
        fortified = true;
      }
    }

    // Research: buy in a fixed order that reflects what a player needs first — medicine,
    // then the lab and the cure, then the economy and the walls.
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
      // One lab, as close to the base as a cleared building allows. Not on day one: the
      // lab costs metal and medicine the first nights need.
      if (!sim.standingLab() && clock.day >= 3 && clock.hour >= 9 && clock.hour < 16 && canPay(stock, BUILDING_FUNCTIONS.lab.cost, 0)) {
        convert("lab", ["house"]);
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
