import type { CityMap } from "./city";

/** Shared world geometry: rendering and navigation must use identical wrecks. */
export interface AbandonedVehicle {
  x: number;
  z: number;
  rot: number;
  scale: number;
  doorOpen: boolean;
  kind: "car" | "ambulance";
}
export function abandonedVehicles(city: CityMap): AbandonedVehicle[] {
  const out: AbandonedVehicle[] = [];
  const medical = new Set<number>();
  let state = (city.seed ^ 0x51a7) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (const road of city.roads) {
    const r = road.rect;
    const path =
      road.path ??
      (road.horizontal
        ? [
            { x: r.x, y: r.y + r.h / 2 },
            { x: r.x + r.w, y: r.y + r.h / 2 },
          ]
        : [
            { x: r.x + r.w / 2, y: r.y },
            { x: r.x + r.w / 2, y: r.y + r.h },
          ]);
    const width = road.width ?? (road.horizontal ? r.h : r.w);
    if (width < 7) continue;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / length,
        dz = (b.y - a.y) / length;
      for (let d = 10 + random() * 10; d < length - 10; d += 18 + random() * 15) {
        const stranded = random() < 0.3;
        const offset = (random() < 0.5 ? -1 : 1) * (stranded ? random() * 0.7 : width / 2 - 1.9);
        const x = a.x + dx * d - dz * offset,
          z = a.y + dz * d + dx * offset;
        if (x < 4 || z < 4 || x > city.width - 4 || z > city.height - 4) continue;
        if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
        if (
          city.buildings.some(
            (b) =>
              Math.hypot(b.entrance.x - x, b.entrance.y - z) < 14 ||
              (x > b.rect.x - 3 && x < b.rect.x + b.rect.w + 3 && z > b.rect.y - 3 && z < b.rect.y + b.rect.h + 3),
          )
        )
          continue;
        const pharmacy = city.buildings.find(
          (b) => b.type === "pharmacy" && !medical.has(b.index) && Math.hypot(b.entrance.x - x, b.entrance.y - z) < 35,
        );
        if (pharmacy) medical.add(pharmacy.index);
        out.push({
          x,
          z,
          rot: Math.atan2(dx, dz) + (random() < 0.5 ? Math.PI : 0) + (random() - 0.5) * (stranded ? 0.7 : 0.12),
          scale: 1,
          doorOpen: !pharmacy && out.length % 3 === 0,
          kind: pharmacy ? "ambulance" : "car",
        });
        if (out.length >= 40) return out;
      }
    }
  }
  return out;
}

/** Conservative oriented rectangle, including body and pedestrian clearance. */
export function vehicleContains(p: AbandonedVehicle, x: number, z: number, margin = 0): boolean {
  const dx = x - p.x,
    dz = z - p.z,
    c = Math.cos(p.rot),
    s = Math.sin(p.rot);
  const lateral = c * dx - s * dz;
  return (
    lateral >= -(p.kind === "ambulance" ? 1.2 : 1.05) - margin &&
    lateral <= (p.doorOpen ? 2.05 : p.kind === "ambulance" ? 1.2 : 1.05) + margin &&
    Math.abs(s * dx + c * dz) <= (p.kind === "ambulance" ? 2.65 : 2.23) + margin
  );
}
