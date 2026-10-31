import { WEAPONS } from "@afterfall/content";
import type { Simulation } from "../simulation";
import type { Entity } from "../state";
import { emitNoise } from "./infected";
import { gainXp } from "./util";

/** Range bonus for survivors posted on a watchtower. */
export const TOWER_RANGE_BONUS = 7;

/** Fraction of weapon range usable when shooting from a window. */
const WINDOW_RANGE = 0.8;
/** Accuracy multiplier when shooting from a window. */
const WINDOW_ACCURACY = 0.85;

/** Survivors automatically engage infected in range; infected deaths are resolved here. */
export function combatSystem(sim: Simulation): void {
  for (const e of sim.survivors()) {
    const s = e.survivor;
    if (s.cooldown > 0) continue;
    if (s.inside >= 0) {
      windowFire(sim, e);
      continue;
    }
    if (s.stance === "passive" && s.activity.type !== "attack") continue;
    const ranged = WEAPONS[s.weapon].usesAmmo && s.ammo > 0;
    const weapon = ranged ? WEAPONS[s.weapon] : WEAPONS.crowbar;
    const range = weapon.range + (s.mounted >= 0 ? TOWER_RANGE_BONUS : 0);
    const t = e.transform!;
    let target: Entity | null = null;
    if (s.activity.type === "attack") {
      const forced = sim.state.entities.get(s.activity.target);
      if (forced?.transform && Math.hypot(forced.transform.x - t.x, forced.transform.y - t.y) <= range) target = forced;
    }
    if (!target) {
      let bestD = range * range;
      sim.infectedHash.query(t.x, t.y, range, (id) => {
        const o = sim.state.entities.get(id);
        if (!o?.transform || !o.infected) return;
        const d = (o.transform.x - t.x) ** 2 + (o.transform.y - t.y) ** 2;
        if (d > bestD) return;
        if (d === bestD && target && o.id > target.id) return;
        if (!sim.grid.lineOfSight(t.x, t.y, o.transform.x, o.transform.y)) return;
        bestD = d;
        target = o;
      });
    }
    if (!target) continue;
    const tgt = target as Entity;
    s.cooldown = weapon.cooldown;
    if (ranged) s.ammo--;
    const accuracy = Math.min(0.97, weapon.accuracy * (0.8 + s.skills.combat * 0.05) * (s.mounted >= 0 ? 1.1 : 1));
    const tt = tgt.transform!;
    sim.emitFx(ranged ? "shot" : "melee", t.x, t.y, tt.x, tt.y);
    t.heading = Math.atan2(tt.y - t.y, tt.x - t.x);
    if (ranged) emitNoise(sim, t.x, t.y, weapon.noise);
    if (sim.rng.chance(accuracy)) {
      tgt.health!.hp -= weapon.damage * (0.85 + sim.rng.next() * 0.3);
      sim.emitFx("hit", tt.x, tt.y);
      if (tgt.health!.hp <= 0) {
        sim.removeEntity(tgt.id);
        sim.emitFx("death", tt.x, tt.y);
        sim.state.stats.infectedKilled++;
        s.kills++;
        gainXp(s, "combat", 8);
      }
    }
    if (ranged && s.ammo === 0) sim.alertOnce(`alert.noAmmo.${e.id}`, 1200, { name: s.name }, "warning", { x: t.x, y: t.y });
  }
}

/**
 * Armed survivors inside a settlement building shoot from its windows at
 * infected near its walls, restocking from the building when it stores
 * ammo. Slower to aim and shorter ranged than shooting in the open, but safe.
 */
function windowFire(sim: Simulation, e: Entity): void {
  const s = e.survivor!;
  const b = sim.state.buildings[s.inside];
  if (!b || b.fn === "none" || s.stance === "passive" || !WEAPONS[s.weapon].usesAmmo) return;
  if (s.ammo === 0 && sim.storageNodes().includes(b)) s.ammo += sim.withdraw("ammo", 10, b);
  if (s.ammo === 0) return;
  const weapon = WEAPONS[s.weapon];
  const range = weapon.range * WINDOW_RANGE;
  const r = sim.city.buildings[s.inside].rect;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let target: Entity | null = null;
  let bestD = range;
  let fx = 0;
  let fy = 0;
  sim.infectedHash.query(cx, cy, range + Math.hypot(r.w, r.h) / 2, (id) => {
    const o = sim.state.entities.get(id);
    if (!o?.transform || !o.infected) return;
    const ox = o.transform.x;
    const oy = o.transform.y;
    // Shoot from the point of the wall closest to the target.
    const wx = Math.max(r.x, Math.min(r.x + r.w, ox));
    const wy = Math.max(r.y, Math.min(r.y + r.h, oy));
    const d = Math.hypot(ox - wx, oy - wy);
    if (d > bestD || (d === bestD && target && o.id > target.id)) return;
    const len = d || 1;
    const sx = wx + ((ox - wx) / len) * 0.6;
    const sy = wy + ((oy - wy) / len) * 0.6;
    if (!sim.grid.lineOfSight(sx, sy, ox, oy)) return;
    bestD = d;
    target = o;
    fx = sx;
    fy = sy;
  });
  if (!target) return;
  const tgt = target as Entity;
  const tt = tgt.transform!;
  s.cooldown = weapon.cooldown;
  s.ammo--;
  sim.emitFx("shot", fx, fy, tt.x, tt.y);
  emitNoise(sim, fx, fy, weapon.noise);
  const accuracy = Math.min(0.95, weapon.accuracy * (0.8 + s.skills.combat * 0.05) * WINDOW_ACCURACY);
  if (sim.rng.chance(accuracy)) {
    tgt.health!.hp -= weapon.damage * (0.85 + sim.rng.next() * 0.3);
    sim.emitFx("hit", tt.x, tt.y);
    if (tgt.health!.hp <= 0) {
      sim.removeEntity(tgt.id);
      sim.emitFx("death", tt.x, tt.y);
      sim.state.stats.infectedKilled++;
      s.kills++;
      gainXp(s, "combat", 8);
    }
  }
}
