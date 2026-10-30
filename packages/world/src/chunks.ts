import type { CityMap } from "./city";

export const CHUNK_SIZE = 128;

export interface WorldChunk {
  id: string;
  x: number;
  y: number;
  buildings: number[];
}

/** Groups buildings into 128 m chunks for culling and region queries. */
export function buildChunks(city: CityMap): WorldChunk[] {
  const map = new Map<string, WorldChunk>();
  for (const b of city.buildings) {
    const x = Math.floor((b.rect.x + b.rect.w / 2) / CHUNK_SIZE);
    const y = Math.floor((b.rect.y + b.rect.h / 2) / CHUNK_SIZE);
    const id = `${x},${y}`;
    let c = map.get(id);
    if (!c) map.set(id, (c = { id, x, y, buildings: [] }));
    c.buildings.push(b.index);
  }
  return [...map.values()];
}
