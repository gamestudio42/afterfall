import { buildTerrain, decodeTerrarium, mapToLatLon, tileXY, type TerrainDef } from "@afterfall/world";

/**
 * Open elevation tiles (AWS Terrain Tiles, Terrarium encoding): public, no key, served
 * with CORS, about 4.5 m a pixel at zoom 15 and 50 KB a tile. A 480 m area needs two to
 * four of them.
 */
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const ZOOM = 15;

async function fetchTile(x: number, y: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const res = await fetch(`${TILES}/${ZOOM}/${x}/${y}.png`, { signal });
  if (!res.ok) throw new Error(`elevation ${res.status}`);
  // No colour management and no premultiplication: the channels are numbers, not colours.
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * The relief of a square area around a point, or null where it is flat. Every tile the
 * area touches is fetched, then the grid is sampled bilinearly between pixel centres.
 */
export async function fetchTerrain(
  lat: number,
  lon: number,
  size: number,
  signal?: AbortSignal,
  onTile: (done: number, total: number) => void = () => {},
): Promise<TerrainDef | null> {
  const corners = [mapToLatLon({ lat, lon }, size, 0, 0), mapToLatLon({ lat, lon }, size, size, size)].map((p) =>
    tileXY(p.lat, p.lon, ZOOM),
  );
  // Two pixels of margin, so the bilinear sample at the map's edge has its neighbours.
  const pad = 2 / 256;
  const x0 = Math.floor(Math.min(corners[0].x, corners[1].x) - pad);
  const x1 = Math.floor(Math.max(corners[0].x, corners[1].x) + pad);
  const y0 = Math.floor(Math.min(corners[0].y, corners[1].y) - pad);
  const y1 = Math.floor(Math.max(corners[0].y, corners[1].y) + pad);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) return null;
  const tiles = new Map<string, Uint8ClampedArray>();
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  onTile(0, total);
  await Promise.all(
    Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, async (_, k) => {
      const tx = x0 + (k % (x1 - x0 + 1));
      const ty = y0 + Math.floor(k / (x1 - x0 + 1));
      tiles.set(`${tx},${ty}`, await fetchTile(tx, ty, signal));
      onTile(tiles.size, total);
    }),
  );
  const pixel = (px: number, py: number): number => {
    const tx = Math.floor(px / 256);
    const ty = Math.floor(py / 256);
    const data = tiles.get(`${tx},${ty}`);
    if (!data) return NaN;
    const i = ((py - ty * 256) * 256 + (px - tx * 256)) * 4;
    return decodeTerrarium(data[i], data[i + 1], data[i + 2]);
  };
  return buildTerrain({ lat, lon }, size, (la, lo) => {
    const t = tileXY(la, lo, ZOOM);
    const fx = t.x * 256 - 0.5;
    const fy = t.y * 256 - 0.5;
    const px = Math.floor(fx);
    const py = Math.floor(fy);
    const u = fx - px;
    const v = fy - py;
    const top = pixel(px, py) * (1 - u) + pixel(px + 1, py) * u;
    const bottom = pixel(px, py + 1) * (1 - u) + pixel(px + 1, py + 1) * u;
    return top * (1 - v) + bottom * v;
  });
}
