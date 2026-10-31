import { cityFromOverpass, overpassQuery, type CityMap, type OverpassResponse } from "@afterfall/world";

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

/** Public Overpass servers, tried in order. */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
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
  return cityFromOverpass(data, { lat: place.lat, lon: place.lon, size, label: place.label });
}

async function fetchOverpass(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  let last: unknown = null;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal,
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
