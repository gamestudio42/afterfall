import { CARRY_CAPACITY, bagWeight } from "@afterfall/content";
import { TICK_SECONDS } from "@afterfall/shared";
import type { Simulation } from "../simulation";
import type { Entity } from "../state";

const ARRIVE_EPS = 0.25;
const SEPARATION = 0.7;

/** Moves every entity with a path along it, with simple collision against the grid. */
export function movementSystem(sim: Simulation): void {
  for (const e of sim.state.entities.values()) {
    const m = e.mover;
    const t = e.transform;
    if (!m || !t) continue;
    if (e.survivor && (e.survivor.inside >= 0 || e.survivor.mounted >= 0)) continue;
    const agent = e.survivor ? "survivor" : "infected";
    if (m.path.length === 0) {
      if (e.infected) separate(sim, e);
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
    if (e.infected) separate(sim, e);
  }
}

/** Pushes overlapping infected apart so hordes spread along walls. */
function separate(sim: Simulation, e: Entity): void {
  const t = e.transform!;
  let px = 0;
  let py = 0;
  sim.infectedHash.query(t.x, t.y, SEPARATION, (id) => {
    if (id === e.id) return;
    const o = sim.state.entities.get(id);
    if (!o || !o.transform) return;
    const dx = t.x - o.transform.x;
    const dy = t.y - o.transform.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= SEPARATION * SEPARATION) return;
    if (d2 < 1e-6) {
      // Deterministic tie break by id.
      px += (e.id % 2 === 0 ? 1 : -1) * 0.05;
      return;
    }
    const d = Math.sqrt(d2);
    const push = ((SEPARATION - d) / d) * 0.25;
    px += dx * push;
    py += dy * push;
  });
  if (px === 0 && py === 0) return;
  const nx = t.x + px;
  const ny = t.y + py;
  if (sim.grid.passable(nx, ny, "infected")) {
    t.x = nx;
    t.y = ny;
  }
}
