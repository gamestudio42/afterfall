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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCityMap(value: unknown): value is CityMap {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.cellSize) &&
    Array.isArray(value.buildings) &&
    Array.isArray(value.roads) &&
    Array.isArray(value.parks) &&
    Array.isArray(value.spawnPoints) &&
    isRecord(value.source) &&
    value.source.kind === "osm"
  );
}

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
  if (!Number.isInteger(save.version) || save.version < 1) throw new Error(`Unsupported save version ${save.version}`);
  if (save.version > SAVE_VERSION) throw new Error(`Save version ${save.version} is newer than supported ${SAVE_VERSION}`);
  switch (save.version) {
    case 1:
      return save;
    default:
      throw new Error(`Unsupported save version ${save.version}`);
  }
}

export function validate(save: unknown): save is SaveGame {
  if (!isRecord(save)) return false;
  if (typeof save.version !== "number" || !Number.isInteger(save.version) || save.version < 1) return false;
  if (!isFiniteNumber(save.worldSeed)) return false;
  if (!isFiniteNumber(save.simulationTick) || !Number.isInteger(save.simulationTick) || save.simulationTick < 0) return false;
  if (!isFiniteNumber(save.rngState)) return false;
  if (typeof save.mapId !== "string" || save.mapId.length === 0) return false;
  if (!isRecord(save.worldState)) return false;

  const ws = save.worldState;
  if (typeof ws.version !== "number" || ws.version !== save.version) return false;
  if (!isFiniteNumber(ws.tick) || !Number.isInteger(ws.tick) || ws.tick < 0) return false;
  if (!Array.isArray(ws.entities) || !Array.isArray(ws.buildings) || !Array.isArray(ws.tasks)) return false;
  if (!Array.isArray(ws.squads) || !Array.isArray(ws.alerts) || !Array.isArray(ws.hordes)) return false;
  if (ws.buildings.length === 0) return false;
  if (!isFiniteNumber(ws.rngState)) return false;
  if (typeof ws.hq !== "number" || !Number.isInteger(ws.hq) || ws.hq < -1 || ws.hq >= ws.buildings.length) return false;

  if (save.mapId.startsWith("osm:")) {
    if (!isCityMap(save.map)) return false;
    if (save.map.buildings.length !== ws.buildings.length) return false;
  } else if (save.map !== undefined && !isCityMap(save.map)) {
    return false;
  }
  return true;
}

export function deserialize(raw: SaveGame | string): Simulation {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  } catch {
    throw new Error("Invalid save file: not valid JSON");
  }
  if (isRecord(parsed) && typeof parsed.mapId === "string" && parsed.mapId.startsWith("osm:") && parsed.map === undefined) {
    throw new Error("Invalid save file: imported map is missing");
  }
  if (!validate(parsed)) throw new Error("Invalid save file");
  const save = migrate(parsed);
  const ws = JSON.parse(JSON.stringify(save.worldState)) as SerializedState;
  const state: GameState = {
    ...ws,
    entities: new Map(ws.entities.map((e) => [e.id, e])),
    tasks: new Map(ws.tasks.map((t) => [t.id, t])),
    rngState: save.rngState,
  };
  const sim = new Simulation({ seed: save.worldSeed, map: save.map }, state);
  if (sim.state.buildings.length !== sim.city.buildings.length) {
    throw new Error("Invalid save file: world state does not match the map");
  }
  return sim;
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
