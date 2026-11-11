import { CARRY_CAPACITY, bagWeight } from "@afterfall/content";
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
    if (e.survivor) {
      const load = bagWeight(e.survivor.carry) / CARRY_CAPACITY;
      speed *= 1 - 0.25 * Math.min(1, load);
      if (e.health && e.health.hp < 30) speed *= 0.75;
    }
    let budget = speed * TICK_SECONDS;
    while (budget > 0 && m.path.length > 0) {
      const target = m.path[0];
      const dx = target.x - t.x;
      const dy = target.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d <= Math.max(ARRIVE_EPS, budget)) {
        if (sim.grid.passable(target.x, target.y, agent) || !sim.grid.passable(t.x, t.y, agent)) {
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
      if (sim.grid.passable(nx, ny, agent)) {
        t.x = nx;
        t.y = ny;
      } else if (sim.grid.passable(nx, t.y, agent)) t.x = nx;
      else if (sim.grid.passable(t.x, ny, agent)) t.y = ny;
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
  if (sim.grid.passable(nx, ny, agent)) {
    t.x = nx;
    t.y = ny;
  }
}
