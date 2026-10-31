import type { SaveGame } from "@afterfall/core";

/** Minimal IndexedDB wrapper for save slots. */
const DB = "afterfall";
const STORE = "saves";

export interface SaveSlot {
  name: string;
  updatedAt: string;
  day: number;
  survivors: number;
  seed: number;
  /** Name of the real place, for games on imported maps. */
  place?: string;
  data: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSave(name: string, save: SaveGame): Promise<void> {
  const slot: SaveSlot = {
    name,
    updatedAt: new Date().toISOString(),
    day: save.metadata.day,
    survivors: save.metadata.survivors,
    seed: save.worldSeed,
    place: save.map?.source?.label,
    data: JSON.stringify(save),
  };
  await tx("readwrite", (s) => s.put(slot));
}

export async function listSaves(): Promise<SaveSlot[]> {
  try {
    const all = await tx<SaveSlot[]>("readonly", (s) => s.getAll() as IDBRequest<SaveSlot[]>);
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function getSave(name: string): Promise<SaveSlot | undefined> {
  return tx<SaveSlot | undefined>("readonly", (s) => s.get(name) as IDBRequest<SaveSlot | undefined>);
}

export async function deleteSave(name: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(name));
}
