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

export const AREA_SIZES = [400, 480, 600];

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
/**
 * How long one server gets before the next is asked. A server that hangs (kumi.systems and
 * private.coffee took over a minute without a byte) must not hold the whole queue.
 */
const SERVER_TIMEOUT_MS = 45_000;
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Finds places by name (OpenStreetMap Nominatim). Call only on an explicit search. */
export async function searchPlaces(query: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=6&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ label: r.display_name.split(",").slice(0, 3).join(","), lat: Number(r.lat), lon: Number(r.lon) }));
}

/**
 * Builds the play map for a place: OpenStreetMap data from the browser
 * cache when present, otherwise from Overpass (then cached).
 */
export async function loadPlaceMap(place: Place, size: number, signal?: AbortSignal): Promise<CityMap> {
  const key = `${place.lat.toFixed(4)},${place.lon.toFixed(4)},${size}`;
  let data = await cacheGet(key);
  if (!data) {
    data = await fetchOverpass(overpassQuery(place.lat, place.lon, size), signal);
    await cachePut(key, data).catch(() => undefined);
  }
  // Water and railways come in a second request of their own, kept under another key: a
  // river's outline can be large, and a slow or refused answer should cost the water, not
  // the map. An area saved before this existed simply fetches it the next time it loads.
  const terrain = await loadTerrain(place, size, signal);
  const city = cityFromOverpass(terrain ? { elements: [...data.elements, ...terrain.elements] } : data, {
    lat: place.lat,
    lon: place.lon,
    size,
    label: place.label,
  });
  const relief = await loadRelief(place, size, signal);
  if (relief) city.terrain = relief;
  return city;
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
async function loadRelief(place: Place, size: number, signal?: AbortSignal): Promise<TerrainDef | null> {
  if (!reliefWanted()) return null;
  const key = `relief:${place.lat.toFixed(4)},${place.lon.toFixed(4)},${size}`;
  const cached = (await cacheGet(key)) as unknown as { terrain: TerrainDef | null } | null;
  if (cached) return cached.terrain;
  try {
    const terrain = await fetchTerrain(place.lat, place.lon, size, signal);
    await cachePut(key, { terrain } as unknown as OverpassResponse).catch(() => undefined);
    return terrain;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("relief unavailable, loading the map flat", e);
    return null;
  }
}

async function loadTerrain(place: Place, size: number, signal?: AbortSignal): Promise<OverpassResponse | null> {
  // "terrain2": the request now includes bridge decks, and an answer cached before that
  // would keep a place without them for good.
  const key = `terrain2:${place.lat.toFixed(4)},${place.lon.toFixed(4)},${size}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  try {
    const data = await fetchOverpass(overpassTerrainQuery(place.lat, place.lon, size), signal);
    await cachePut(key, data).catch(() => undefined);
    return data;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("water and railways unavailable, loading the map without them", e);
    return null;
  }
}

/** Pause before the second round: a busy server's 502 usually clears within seconds. */
const RETRY_PAUSE_MS = 4_000;

async function fetchOverpass(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  try {
    return await fetchRound(OVERPASS, query, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    // A second round, after a pause, on the two servers that do answer when they are not
    // overloaded: on 2026-11-20 the main one went from 502 to 200 within minutes.
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    if (signal?.aborted) throw e;
    return fetchRound(OVERPASS.slice(0, 2), query, signal);
  }
}

async function fetchRound(servers: string[], query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  let last: unknown = null;
  for (const url of servers) {
    try {
      const timeout = AbortSignal.timeout(SERVER_TIMEOUT_MS);
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
