import type { CityMap } from "@afterfall/world";
import { Simulation, SAVE_VERSION } from "./simulation";
import type { Entity, GameState, Task } from "./state";

export interface SaveGame {
  version: number;
  metadata: { name: string; createdAt: string; updatedAt: string; day: number; survivors: number };
  worldSeed: number;
  mapId: string;
  simulationTick: number;
  rngState: number;
  worldState: SerializedState;
  /** The whole map for imported real places, which cannot be regenerated from a seed. */
  map?: CityMap;
}

type SerializedState = Omit<GameState, "entities" | "tasks"> & { entities: Entity[]; tasks: Task[] };

export function serialize(sim: Simulation, name = "save"): SaveGame {
  const st = sim.state;
  st.rngState = sim.rng.state;
  const now = new Date().toISOString();
  const worldState: SerializedState = {
    ...st,
    entities: [...st.entities.values()],
    tasks: [...st.tasks.values()],
  };
  return {
    version: SAVE_VERSION,
    metadata: { name, createdAt: now, updatedAt: now, day: sim.clock.day, survivors: sim.survivorCount() },
    worldSeed: st.seed,
    mapId: sim.city.source ? `osm:${sim.city.source.lat.toFixed(5)},${sim.city.source.lon.toFixed(5)},${sim.city.source.size}` : `procedural:${st.seed}`,
    simulationTick: st.tick,
    rngState: sim.rng.state,
    // Deep copy so the save does not alias live state.
    worldState: JSON.parse(JSON.stringify(worldState)),
    ...(sim.city.source ? { map: sim.city } : {}),
  };
}

/** Upgrades older save formats in place. Add a case per version bump. */
export function migrate(save: SaveGame): SaveGame {
  if (save.version > SAVE_VERSION) throw new Error(`Save version ${save.version} is newer than supported ${SAVE_VERSION}`);
  return save;
}

export function validate(save: unknown): save is SaveGame {
  const s = save as SaveGame;
  return (
    !!s &&
    typeof s.version === "number" &&
    typeof s.worldSeed === "number" &&
    typeof s.simulationTick === "number" &&
    !!s.worldState &&
    Array.isArray(s.worldState.entities) &&
    Array.isArray(s.worldState.buildings)
  );
}

export function deserialize(raw: SaveGame | string): Simulation {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as SaveGame) : raw;
  if (!validate(parsed)) throw new Error("Invalid save file");
  const save = migrate(parsed);
  const ws = JSON.parse(JSON.stringify(save.worldState)) as SerializedState;
  const state: GameState = {
    ...ws,
    entities: new Map(ws.entities.map((e) => [e.id, e])),
    tasks: new Map(ws.tasks.map((t) => [t.id, t])),
    rngState: save.rngState,
  };
  return new Simulation({ seed: save.worldSeed, map: save.map }, state);
}

/** Stable digest of the simulation state, for determinism tests. */
export function stateHash(sim: Simulation): string {
  const s = JSON.stringify(serialize(sim).worldState);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
