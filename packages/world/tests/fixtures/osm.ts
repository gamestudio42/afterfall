import type { OverpassElement, OverpassResponse } from "../../src";

/**
 * Builds a synthetic Overpass answer: a street grid rotated 17 degrees, rows
 * of rotated buildings (one L-shaped), a closed courtyard building, a park
 * and points of interest. No network is needed to test the importer.
 */
export const FIXTURE_CENTER = { lat: -23.5505, lon: -46.6333 };

export function syntheticOverpass(size = 480): OverpassResponse {
  const { lat, lon } = FIXTURE_CENTER;
  const kLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const angle = (17 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Local meters around the center (x east, y south) to lat/lon, after rotation.
  const geo = (x: number, y: number) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { lat: lat - ry / 111_132, lon: lon + rx / kLon };
  };
  const elements: OverpassElement[] = [];
  let id = 1000;
  const way = (pts: [number, number][], tags: Record<string, string>, closed = false) => {
    const g = pts.map(([x, y]) => geo(x, y));
    if (closed) g.push(g[0]);
    elements.push({ type: "way", id: id++, tags, geometry: g });
  };
  const half = size * 0.75;
  const pitch = 70;
  for (let k = -4; k <= 4; k++) {
    way([[-half, k * pitch], [half, k * pitch]], { highway: k === 0 ? "secondary" : "residential" });
    way([[k * pitch, -half], [k * pitch, half]], { highway: "residential" });
  }
  // Footpaths are ignored.
  way([[-20, -20], [20, 20]], { highway: "footway" });

  for (let bx = -3; bx < 3; bx++)
    for (let by = -3; by < 3; by++) {
      const x0 = bx * pitch + 8;
      const y0 = by * pitch + 8;
      if (bx === 1 && by === 1) {
        way([[x0, y0], [x0 + 50, y0], [x0 + 50, y0 + 50], [x0, y0 + 50]], { leisure: "park" }, true);
        continue;
      }
      if (bx === -1 && by === -1) {
        // A large tall block.
        way([[x0, y0], [x0 + 54, y0], [x0 + 54, y0 + 54], [x0, y0 + 54]], { building: "apartments", "building:levels": "6" }, true);
        continue;
      }
      if (bx === 0 && by === 0) {
        // An L-shaped school.
        way([[x0, y0], [x0 + 50, y0], [x0 + 50, y0 + 20], [x0 + 20, y0 + 20], [x0 + 20, y0 + 50], [x0, y0 + 50]], { building: "school" }, true);
        continue;
      }
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 2; j++) {
          const x = x0 + i * 18;
          const y = y0 + j * 30;
          const tags: Record<string, string> = { building: (bx + by + i) % 4 === 0 ? "yes" : "house" };
          if ((bx + i) % 3 === 0) tags["building:levels"] = String(2 + ((i + j) % 4));
          way([[x, y], [x + 14, y], [x + 14, y + 20], [x, y + 20]], tags, true);
        }
    }
  // Points of interest inside buildings.
  const poi = (x: number, y: number, tags: Record<string, string>) => elements.push({ type: "node", id: id++, ...geo(x, y), tags });
  poi(-2 * pitch + 8 + 7, -2 * pitch + 8 + 10, { shop: "supermarket" });
  poi(2 * pitch + 8 + 7, -2 * pitch + 8 + 10, { amenity: "police" });
  poi(-3 * pitch + 8 + 25, 2 * pitch + 8 + 10, { amenity: "pharmacy" });
  return { elements };
}
