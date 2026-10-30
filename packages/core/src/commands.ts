import { BALANCE, RESOURCE_IDS, addToBag, type BuildingFunction, type StructureKind } from "@afterfall/content";
import type { Simulation } from "./simulation";
import type { EntityId, Policies, Stance } from "./state";
import { resolveEvent } from "./systems/events";
import { killSurvivor, returnToBase } from "./systems/survivors";
import { cancelTask, placeStructures, releaseFromTask, startConversion } from "./systems/tasks";
import { destroyStructure } from "./systems/infected";
import { exitBuilding } from "./systems/util";

/**
 * Player intents. The UI never mutates simulation state directly; it
 * enqueues commands that are applied at the start of the next tick.
 */
export type Command =
  | { type: "setBase"; building: number }
  | { type: "move"; units: EntityId[]; x: number; y: number }
  | { type: "scavenge"; units: EntityId[]; building: number }
  | { type: "attack"; units: EntityId[]; target: EntityId }
  | { type: "returnToBase"; units: EntityId[] }
  | { type: "stop"; units: EntityId[] }
  | { type: "setAuto"; units: EntityId[] }
  | { type: "setStance"; units: EntityId[]; stance: Stance }
  | { type: "placeStructures"; kind: StructureKind; cells: [number, number][] }
  | { type: "convert"; building: number; fn: BuildingFunction }
  | { type: "cancelTask"; task: number }
  | { type: "setTaskPriority"; task: number; priority: number }
  | { type: "demolish"; structure: EntityId }
  | { type: "createSquad"; units: EntityId[]; name: string }
  | { type: "disbandSquad"; squad: number }
  | { type: "resolveEvent"; choice: number }
  | { type: "setPolicy"; policy: Partial<Policies> };

function units(sim: Simulation, ids: EntityId[]) {
  return ids
    .map((id) => sim.state.entities.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e?.survivor);
}

/** Spreads a group around a point so they do not stack on one cell. */
function formationOffset(i: number): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  const ring = Math.ceil((Math.sqrt(i + 1) - 1) / 2);
  const angle = i * 2.399963;
  return { x: Math.cos(angle) * ring * 1.6, y: Math.sin(angle) * ring * 1.6 };
}

export function applyCommand(sim: Simulation, cmd: Command): void {
  const st = sim.state;
  switch (cmd.type) {
    case "setBase": {
      if (st.hq >= 0 || st.outcome) return;
      const b = st.buildings[cmd.building];
      if (!b) return;
      st.hq = cmd.building;
      sim.setBuildingFunction(cmd.building, "hq");
      b.explored = true;
      b.hiddenInfected = 0;
      // The founding group cleared the building and kept part of what was inside.
      for (const id of RESOURCE_IDS) {
        const v = Math.floor((b.remainingLoot[id] ?? 0) * 0.5);
        if (v > 0) addToBag(b.storage, id, v);
      }
      b.remainingLoot = {};
      b.searchProgress = b.searchTotal;
      for (const [id, v] of Object.entries(BALANCE.startingResources)) addToBag(b.storage, id as never, v);
      const ent = sim.city.buildings[cmd.building].entrance;
      for (const z of [...sim.infected()]) {
        if (Math.hypot(z.transform!.x - ent.x, z.transform!.y - ent.y) < 55) sim.removeEntity(z.id);
      }
      for (let i = 0; i < BALANCE.startingSurvivors; i++) {
        const o = formationOffset(i);
        const p = sim.grid.nearestPassable(ent.x + o.x, ent.y + o.y, "survivor", 4) ?? ent;
        sim.spawnSurvivor(p.x, p.y, { weapon: i < 2 ? "pistol" : "crowbar" });
      }
      st.started = true;
      sim.alert("alert.baseEstablished", { type: sim.city.buildings[cmd.building].type }, "success", ent);
      return;
    }
    case "move": {
      const list = units(sim, cmd.units);
      list.forEach((e, i) => {
        const s = e.survivor!;
        releaseFromTask(sim, e);
        if (s.inside >= 0) exitBuilding(sim, e);
        const o = formationOffset(i);
        s.manual = true;
        s.navFails = 0;
        s.activity = { type: "move", x: cmd.x + o.x, y: cmd.y + o.y };
        if (!sim.setDestination(e, cmd.x + o.x, cmd.y + o.y, "survivor")) s.activity = { type: "idle" };
      });
      return;
    }
    case "scavenge": {
      const b = st.buildings[cmd.building];
      if (!b || b.fn !== "none") return;
      const ent = sim.city.buildings[cmd.building].entrance;
      for (const e of units(sim, cmd.units)) {
        const s = e.survivor!;
        releaseFromTask(sim, e);
        if (s.inside >= 0) exitBuilding(sim, e);
        s.manual = true;
        s.navFails = 0;
        s.activity = { type: "scavenge", building: cmd.building, phase: "going" };
        if (!sim.setDestination(e, ent.x, ent.y, "survivor")) s.activity = { type: "idle" };
      }
      b.explored = true;
      return;
    }
    case "attack": {
      for (const e of units(sim, cmd.units)) {
        releaseFromTask(sim, e);
        if (e.survivor!.inside >= 0) exitBuilding(sim, e);
        e.survivor!.manual = true;
        e.survivor!.activity = { type: "attack", target: cmd.target };
      }
      return;
    }
    case "returnToBase":
      for (const e of units(sim, cmd.units)) returnToBase(sim, e as never);
      return;
    case "stop":
      for (const e of units(sim, cmd.units)) {
        releaseFromTask(sim, e);
        e.survivor!.manual = true;
        e.survivor!.activity = { type: "idle" };
        sim.stop(e);
      }
      return;
    case "setAuto":
      for (const e of units(sim, cmd.units)) {
        e.survivor!.manual = false;
        if (e.survivor!.activity.type === "move" || e.survivor!.activity.type === "attack") e.survivor!.activity = { type: "idle" };
      }
      return;
    case "setStance":
      for (const e of units(sim, cmd.units)) e.survivor!.stance = cmd.stance;
      return;
    case "placeStructures":
      if (placeStructures(sim, cmd.kind, cmd.cells)) sim.alert("alert.blueprintPlaced", { kind: cmd.kind }, "info");
      return;
    case "convert":
      if (startConversion(sim, cmd.building, cmd.fn)) sim.alert("alert.conversionStarted", { fn: cmd.fn }, "info");
      return;
    case "cancelTask": {
      const t = st.tasks.get(cmd.task);
      if (t && t.type !== "farm" && t.type !== "guard" && t.type !== "craft") cancelTask(sim, t);
      return;
    }
    case "setTaskPriority": {
      const t = st.tasks.get(cmd.task);
      if (t) t.priority = Math.max(0, Math.min(100, cmd.priority));
      return;
    }
    case "demolish": {
      const e = st.entities.get(cmd.structure);
      if (!e?.structure) return;
      if (!e.structure.built) {
        const t = st.tasks.get(e.structure.task);
        if (t) cancelTask(sim, t);
        return;
      }
      destroyStructure(sim, e);
      return;
    }
    case "createSquad": {
      const list = units(sim, cmd.units);
      if (list.length === 0) return;
      for (const sq of st.squads) sq.members = sq.members.filter((m) => !cmd.units.includes(m));
      st.squads = st.squads.filter((sq) => sq.members.length > 0);
      const id = st.nextId++;
      st.squads.push({ id, name: cmd.name, members: list.map((e) => e.id) });
      for (const e of list) e.survivor!.squad = id;
      return;
    }
    case "disbandSquad":
      st.squads = st.squads.filter((sq) => sq.id !== cmd.squad);
      for (const e of sim.survivors()) if (e.survivor.squad === cmd.squad) e.survivor.squad = -1;
      return;
    case "resolveEvent":
      resolveEvent(sim, cmd.choice);
      return;
    case "setPolicy":
      Object.assign(st.policies, cmd.policy);
      return;
  }
}

export { killSurvivor };
