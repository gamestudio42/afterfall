import {
  cityFromOverpass,
  overpassQuery,
  overpassTerrainQuery,
  type CityMap,
  type OverpassResponse,
  type TerrainDef,
} from "@afterfall/world";
import { fetchTerrain } from "./elevation";

/** A place to play: a named point and the side of the square area around it. */
export interface Place {
  label: string;
  lat: number;
  lon: number;
}

/** Ready-made places, so a real map is one click away. */
export const PLACE_PRESETS: Place[] = [
  { label: "São Paulo · Sé", lat: -23.5503, lon: -46.634 },
  { label: "Rio de Janeiro · Copacabana", lat: -22.9695, lon: -43.1865 },
  { label: "Porto Alegre · Cidade Baixa", lat: -30.042, lon: -51.22 },
  { label: "Curitiba · Centro", lat: -25.4295, lon: -49.2713 },
  { label: "Lisboa · Baixa", lat: 38.7107, lon: -9.1372 },
  { label: "New York · Greenwich Village", lat: 40.7336, lon: -74.0027 },
  { label: "London · Soho", lat: 51.5136, lon: -0.134 },
  { label: "Tokyo · Shibuya", lat: 35.6595, lon: 139.7005 },
];

/** Sides offered for a real place, in metres. 800 is opt-in: it covers more city and loads slower. */
export const AREA_SIZES = [400, 480, 600, 800];
/** The size selected when the picker opens. 480 m has been the default since the list was three sizes. */
export const DEFAULT_AREA_SIZE = 480;

/**
 * Public Overpass servers, tried in order. The main one answers 502 when it is busy, and
 * private.coffee then often did too; its error pages carry no CORS header, so the browser
 * reports them as blocked. maps.mail.ru answered while both were down, with CORS open.
 */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/**
 * IndexedDB key for one downloaded layer. The side in metres is part of it, so an 800 m
 * area never reuses a 600 m answer.
 */
export function placeCacheKey(lat: number, lon: number, size: number, prefix = ""): string {
  return `${prefix}${lat.toFixed(4)},${lon.toFixed(4)},${size}`;
}

/**
 * How long one Overpass server gets before the next is asked: five seconds past the
 * query's own `[timeout]`, so a timeout page still arrives. A server that hangs
 * (kumi.systems and private.coffee took over a minute without a byte) must not hold the
 * queue past that. An 800 m query asks for longer than a 600 m one.
 */
export function serverTimeoutMs(query: string): number {
  const match = /\[timeout:(\d+)\]/.exec(query);
  const seconds = match ? Number(match[1]) : 40;
  return (seconds + 5) * 1000;
}

/** Finds places by name (OpenStreetMap Nominatim). Call only on an explicit search. */
export async function searchPlaces(query: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=6&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ label: r.display_name.split(",").slice(0, 3).join(","), lat: Number(r.lat), lon: Number(r.lon) }));
}

/** The steps of loading a place, in the order the player sees them. */
export const LOAD_STEPS = ["map", "water", "relief", "city"] as const;
export type LoadStep = (typeof LOAD_STEPS)[number];

/**
 * Where one step stands. `server` is the host being asked and `attempt` which try of how
 * many; `retryIn` the seconds before the second round; `tiles` the elevation tiles in.
 */
export interface LoadProgress {
  step: LoadStep;
  state: "active" | "done" | "cached" | "skipped" | "failed";
  server?: string;
  attempt?: number;
  attempts?: number;
  retryIn?: number;
  tiles?: [number, number];
}
export type OnProgress = (p: LoadProgress) => void;

const host = (url: string) => new URL(url).host;

/**
 * Builds the play map for a place: OpenStreetMap data from the browser
 * cache when present, otherwise from Overpass (then cached). `onProgress` hears every
 * step: which server is being asked, a retry, a step served from the cache.
 */
export async function loadPlaceMap(place: Place, size: number, signal?: AbortSignal, onProgress: OnProgress = () => {}): Promise<CityMap> {
  const key = placeCacheKey(place.lat, place.lon, size);
  let data = await cacheGet(key);
  if (data) onProgress({ step: "map", state: "cached" });
  else {
    try {
      data = await fetchOverpass(overpassQuery(place.lat, place.lon, size), signal, (p) => onProgress({ step: "map", ...p }));
    } catch (e) {
      if (!signal?.aborted) onProgress({ step: "map", state: "failed" });
      throw e;
    }
    onProgress({ step: "map", state: "done" });
    await cachePut(key, data).catch(() => undefined);
  }
  // Water and railways come in a second request of their own, kept under another key: a
  // river's outline can be large, and a slow or refused answer should cost the water, not
  // the map. An area saved before this existed simply fetches it the next time it loads.
  const [terrain, relief] = await Promise.all([loadTerrain(place, size, signal, onProgress), loadRelief(place, size, signal, onProgress)]);
  onProgress({ step: "city", state: "active" });
  // Let the list repaint before the import, which holds the main thread for a moment.
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    // The relief goes in before the import: its cliffs decide which doors can be reached.
    const city = cityFromOverpass(terrain ? { elements: [...data.elements, ...terrain.elements] } : data, {
      lat: place.lat,
      lon: place.lon,
      size,
      label: place.label,
      ...(relief ? { terrain: relief } : {}),
    });
    onProgress({ step: "city", state: "done" });
    return city;
  } catch (e) {
    onProgress({ step: "city", state: "failed" });
    throw e;
  }
}

/** `?terrain=0` turns the relief off: a flat map, as before it existed. */
function reliefWanted(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("terrain") !== "0";
  } catch {
    return true;
  }
}

/**
 * The ground's relief, a third and optional request: open elevation tiles, kept in the
 * cache like the rest. A refused or slow answer costs the relief, never the map.
 */
async function loadRelief(place: Place, size: number, signal: AbortSignal | undefined, onProgress: OnProgress): Promise<TerrainDef | null> {
  if (!reliefWanted()) {
    onProgress({ step: "relief", state: "skipped" });
    return null;
  }
  const key = placeCacheKey(place.lat, place.lon, size, "relief:");
  const cached = (await cacheGet(key)) as unknown as { terrain: TerrainDef | null } | null;
  if (cached) {
    onProgress({ step: "relief", state: "cached" });
    return cached.terrain;
  }
  onProgress({ step: "relief", state: "active" });
  try {
    const terrain = await fetchTerrain(place.lat, place.lon, size, signal, (done, total) =>
      onProgress({ step: "relief", state: "active", tiles: [done, total] }),
    );
    await cachePut(key, { terrain } as unknown as OverpassResponse).catch(() => undefined);
    onProgress({ step: "relief", state: "done" });
    return terrain;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("relief unavailable, loading the map flat", e);
    onProgress({ step: "relief", state: "skipped" });
    return null;
  }
}

async function loadTerrain(
  place: Place,
  size: number,
  signal: AbortSignal | undefined,
  onProgress: OnProgress,
): Promise<OverpassResponse | null> {
  // The version goes up whenever the request asks for more: "terrain2" added bridge decks,
  // "terrain3" city walls, "terrain4" statues and monuments. An answer cached before that
  // would keep a place without them.
  const key = placeCacheKey(place.lat, place.lon, size, "terrain4:");
  const cached = await cacheGet(key);
  if (cached) {
    onProgress({ step: "water", state: "cached" });
    return cached;
  }
  try {
    const data = await fetchOverpass(overpassTerrainQuery(place.lat, place.lon, size), signal, (p) => onProgress({ step: "water", ...p }));
    await cachePut(key, data).catch(() => undefined);
    onProgress({ step: "water", state: "done" });
    return data;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("water and railways unavailable, loading the map without them", e);
    onProgress({ step: "water", state: "skipped" });
    return null;
  }
}

/** Pause before the second round: a busy server's 502 usually clears within seconds. */
const RETRY_PAUSE_MS = 4_000;

type Attempt = (p: Omit<LoadProgress, "step">) => void;

async function fetchOverpass(query: string, signal?: AbortSignal, report: Attempt = () => {}): Promise<OverpassResponse> {
  const second = OVERPASS.slice(0, 2);
  const attempts = OVERPASS.length + second.length;
  try {
    return await fetchRound(OVERPASS, query, signal, (url, k) => report({ state: "active", server: host(url), attempt: k + 1, attempts }));
  } catch (e) {
    if (signal?.aborted) throw e;
    // A second round, after a pause, on the two servers that do answer when they are not
    // overloaded: on 2026-11-20 the main one went from 502 to 200 within minutes.
    report({ state: "active", retryIn: Math.round(RETRY_PAUSE_MS / 1000) });
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    if (signal?.aborted) throw e;
    return fetchRound(second, query, signal, (url, k) =>
      report({ state: "active", server: host(url), attempt: OVERPASS.length + k + 1, attempts }),
    );
  }
}

async function fetchRound(
  servers: string[],
  query: string,
  signal: AbortSignal | undefined,
  asking: (url: string, k: number) => void,
): Promise<OverpassResponse> {
  let last: unknown = null;
  for (const [k, url] of servers.entries()) {
    asking(url, k);
    try {
      const timeout = AbortSignal.timeout(serverTimeoutMs(query));
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      return (await res.json()) as OverpassResponse;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw last ?? new Error("overpass");
}

// Downloaded areas are kept in IndexedDB so a place loads offline the next time.
const DB = "afterfall-maps";
const STORE = "overpass";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<OverpassResponse | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as OverpassResponse) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key: string, data: OverpassResponse): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(data, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
