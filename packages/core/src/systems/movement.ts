import { BALANCE, CARRY_CAPACITY, SURVIVOR_HURRY_RADIUS, SURVIVOR_WALK_SPEED, bagWeight } from "@afterfall/content";
import { heightAt } from "@afterfall/world";
import { TICK_SECONDS } from "@afterfall/shared";
import type { Simulation } from "../simulation";
import type { Entity } from "../state";

const ARRIVE_EPS = 0.25;
/** How close infected and survivors stand before they push each other apart, in metres. */
const SEPARATION = 0.7;
/**
 * Survivors keep more room than the infected.
 *
 * A person is 0.7 m wide, so a metre apart was still one silhouette from an RTS camera at
 * two hundred metres: four people read as one, which is the eleventh playtest report. At
 * 1.35 m they stand as a group you can count, and it is still under one 2 m cell, so a
 * queue at a door still fits.
 */
const SURVIVOR_SEPARATION = 1.35;

/** Moves every entity with a path along it, with simple collision against the grid. */
export function movementSystem(sim: Simulation): void {
  for (const e of sim.state.entities.values()) {
    const m = e.mover;
    const t = e.transform;
    if (!t) continue;
    if (e.survivor && (e.survivor.inside >= 0 || e.survivor.mounted >= 0)) continue;
    if (!m) {
      // A guard at its post has no path and no mover; skipping it here is what let two
      // defenders stand on exactly the same spot, which is the eleventh playtest report.
      separate(sim, e);
      continue;
    }
    const agent = e.survivor ? "survivor" : "infected";
    if (m.path.length === 0) {
      separate(sim, e);
      continue;
    }
    // A wall may have been built across the path; replan when the grid changed.
    if (m.gridVersion !== sim.grid.version && m.goal) {
      const next = m.path[0];
      if (!sim.grid.walkable(t.x, t.y, next.x, next.y, agent, 0)) {
        if (!sim.setDestination(e, m.goal.x, m.goal.y, agent)) continue;
      } else m.gridVersion = sim.grid.version;
    }
    let speed = m.speed;
    if (e.survivor && !hurried(sim, e)) speed = Math.min(speed, SURVIVOR_WALK_SPEED);
    if (e.survivor) {
      const load = bagWeight(e.survivor.carry) / CARRY_CAPACITY;
      speed *= 1 - 0.25 * Math.min(1, load);
      if (e.health && e.health.hp < 30) speed *= 0.75;
    }
    // Uphill is slow: speed / (1 + k * rise) toward the next waypoint. Downhill is not faster.
    const terrain = sim.city.terrain;
    if (terrain && m.path.length > 0) {
      const next = m.path[0];
      const run = Math.hypot(next.x - t.x, next.y - t.y);
      if (run > 0.05) {
        const rise = (heightAt(terrain, next.x, next.y) - heightAt(terrain, t.x, t.y)) / run;
        speed = climbSpeed(speed, rise);
      }
    }
    let budget = speed * TICK_SECONDS;
    while (budget > 0 && m.path.length > 0) {
      const target = m.path[0];
      const dx = target.x - t.x;
      const dy = target.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d <= Math.max(ARRIVE_EPS, budget)) {
        if (canStep(sim, t.x, t.y, target.x, target.y, agent) || !sim.grid.passable(t.x, t.y, agent)) {
          t.x = target.x;
          t.y = target.y;
        }
        budget -= d;
        m.path.shift();
        if (m.path.length === 0) m.goal = null;
        continue;
      }
      const nx = t.x + (dx / d) * budget;
      const ny = t.y + (dy / d) * budget;
      t.heading = Math.atan2(dy, dx);
      if (canStep(sim, t.x, t.y, nx, ny, agent)) {
        t.x = nx;
        t.y = ny;
      } else if (canStep(sim, t.x, t.y, nx, t.y, agent)) t.x = nx;
      else if (canStep(sim, t.x, t.y, t.x, ny, agent)) t.y = ny;
      budget = 0;
    }
    // Stuck detection: replan if no real progress for a while.
    if (m.path.length > 0) {
      const moved = Math.hypot(t.x - m.lastProgressX, t.y - m.lastProgressY);
      if (moved > 0.6) {
        m.lastProgressX = t.x;
        m.lastProgressY = t.y;
        m.stuckTicks = 0;
      } else if (++m.stuckTicks > 40 && m.goal) {
        m.stuckTicks = 0;
        const goal = m.goal;
        if (!sim.setDestination(e, goal.x, goal.y, agent)) {
          sim.stop(e);
        }
      }
    }
    separate(sim, e);
  }
}

/** Activities a survivor runs through rather than walks. */
const HURRIED = new Set(["move", "attack", "flee", "returnBase", "defend"]);

/**
 * Whether a survivor jogs or walks: jogs when the player sent it, when it is fighting,
 * fleeing or falling back, or when an infected is within `SURVIVOR_HURRY_RADIUS`; walks
 * about its chores otherwise.
 */
export function hurried(sim: Simulation, e: Entity): boolean {
  const s = e.survivor!;
  if (s.manual || HURRIED.has(s.activity.type)) return true;
  const t = e.transform!;
  let near = false;
  sim.infectedHash.query(t.x, t.y, SURVIVOR_HURRY_RADIUS, (id) => {
    if (near) return;
    const o = sim.state.entities.get(id)?.transform;
    if (o && (o.x - t.x) ** 2 + (o.y - t.y) ** 2 < SURVIVOR_HURRY_RADIUS ** 2) near = true;
  });
  return near;
}

/** Walking speed up a slope of `rise` (rise over run): slower uphill, never faster downhill. */
export function climbSpeed(speed: number, rise: number): number {
  return rise > 0 ? speed / (1 + BALANCE.terrainClimbCost * rise) : speed;
}

/**
 * Pushes an entity out of the ones it overlaps.
 *
 * This existed for infected only, so a horde spread along a wall — and the settlement's
 * survivors, who queue at the same door and idle on the same tile, stood exactly on top of
 * each other. Four people looked like one, which is the eleventh playtest report. The push
 * is soft and never moves anyone into a cell they could not walk, so it separates a crowd
 * without breaking a path.
 */
function separate(sim: Simulation, e: Entity): void {
  const t = e.transform!;
  const survivor = Boolean(e.survivor);
  const agent = survivor ? "survivor" : "infected";
  const hash = survivor ? sim.survivorHash : sim.infectedHash;
  const radius = survivor ? SURVIVOR_SEPARATION : SEPARATION;
  const strength = survivor ? 0.35 : 0.25;
  let px = 0;
  let py = 0;
  hash.query(t.x, t.y, radius, (id) => {
    if (id === e.id) return;
    const o = sim.state.entities.get(id);
    if (!o || !o.transform) return;
    const dx = t.x - o.transform.x;
    const dy = t.y - o.transform.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) return;
    if (d2 < 1e-6) {
      // Deterministic tie break by id.
      px += (e.id % 2 === 0 ? 1 : -1) * 0.05;
      return;
    }
    const d = Math.sqrt(d2);
    const push = ((radius - d) / d) * strength;
    px += dx * push;
    py += dy * push;
  });
  if (px === 0 && py === 0) return;
  const nx = t.x + px;
  const ny = t.y + py;
  if (canStep(sim, t.x, t.y, nx, ny, agent)) {
    t.x = nx;
    t.y = ny;
  }
}

/**
 * Whether a body may move from one point to another, at most a cell away. The end has to
 * be walkable, and a step into a diagonal cell may not cut its corner: a diagonal wall is
 * a staircase of cells that touch only at their corners, and checking the end alone let a
 * crowd pressed against one squeeze through at every step of it.
 */
export function canStep(sim: Simulation, x0: number, y0: number, x1: number, y1: number, agent: "survivor" | "infected"): boolean {
  const g = sim.grid;
  if (!g.passable(x1, y1, agent)) return false;
  const c = g.cell;
  const ax = Math.floor(x0 / c);
  const ay = Math.floor(y0 / c);
  const bx = Math.floor(x1 / c);
  const by = Math.floor(y1 / c);
  if (ax === bx || ay === by) return true;
  return g.passable((bx + 0.5) * c, (ay + 0.5) * c, agent) && g.passable((ax + 0.5) * c, (by + 0.5) * c, agent);
}
