import { describe, expect, it } from "vitest";
import type { CityMap } from "@afterfall/world";
import {
  OUTSKIRTS_FAR,
  OUTSKIRTS_NEAR,
  buildOutskirts,
  outskirtStreets,
  placeOutskirts,
  skyColors,
  skyInView,
  streetGrain,
} from "../src/sky";
import { generateVariedCity } from "@afterfall/world";
import { WEATHER, easeWeather, rainBox, weatherFor } from "../src/weather";

function city(): CityMap {
  const blockSize = 40;
  const roadWidth = 8;
  const blocks = 3;
  const width = blocks * (blockSize + roadWidth) + roadWidth;
  const roads = [];
  for (let i = 0; i <= blocks; i++) {
    roads.push({ id: `rh${i}`, horizontal: true, rect: { x: 0, y: i * 48, w: width, h: roadWidth } });
    roads.push({ id: `rv${i}`, horizontal: false, rect: { x: i * 48, y: 0, w: roadWidth, h: width } });
  }
  return {
    seed: 7,
    name: "Test",
    width,
    height: width,
    cellSize: 2,
    blockSize,
    roadWidth,
    blocksX: blocks,
    blocksY: blocks,
    roads,
    intersections: [],
    buildings: [],
    parks: [],
    spawnPoints: [],
  } as unknown as CityMap;
}

describe("sky", () => {
  it("is blue overhead by day and dark at night", () => {
    const day = skyColors(1, 0, 0);
    const night = skyColors(0, 0, 0);
    expect(day.zenith[2]).toBeGreaterThan(day.zenith[0] * 2);
    expect(Math.max(...night.zenith)).toBeLessThan(0.12);
    expect(day.horizon[0]).toBeGreaterThan(day.zenith[0]);
  });

  it("warms the horizon at sunset, and not at noon or at night", () => {
    const warmth = (c: { horizon: number[] }) => c.horizon[0] - c.horizon[2];
    expect(warmth(skyColors(0.5, 1, 0))).toBeGreaterThan(0.2);
    expect(warmth(skyColors(1, 1, 0))).toBeLessThan(0);
    expect(warmth(skyColors(0, 1, 0))).toBeLessThan(0);
  });

  it("is drawn only when the camera tilts low enough to see it", () => {
    const fov = (42 * Math.PI) / 180;
    expect(skyInView(0.92, fov)).toBe(false);
    expect(skyInView(0.45, fov)).toBe(false);
    expect(skyInView(0.26, fov)).toBe(true);
  });

  it("goes grey under cloud", () => {
    const c = skyColors(1, 0, 1);
    expect(c.zenith[2] - c.zenith[0]).toBeLessThan(0.2);
    expect(skyColors(1, 0, 0).zenith[2] - skyColors(1, 0, 0).zenith[0]).toBeGreaterThan(0.5);
  });
});

describe("outskirts", () => {
  const map = city();
  const boxes = placeOutskirts(map, 3);

  it("surrounds the map without entering it", () => {
    expect(boxes.length).toBeGreaterThan(100);
    for (const b of boxes) {
      const dx = Math.max(-b.x - b.w / 2, b.x - b.w / 2 - map.width, 0);
      const dz = Math.max(-b.z - b.d / 2, b.z - b.d / 2 - map.height, 0);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(OUTSKIRTS_NEAR - 20);
      expect(Math.hypot(dx, dz)).toBeLessThan(OUTSKIRTS_FAR + 20);
      const inside = b.x > 0 && b.x < map.width && b.z > 0 && b.z < map.height;
      expect(inside).toBe(false);
    }
  });

  it("keeps the corridors where streets leave the map clear", () => {
    // The street at x 48..56 leaves north and south: nothing may stand in its line there.
    const blocking = boxes.filter((b) => b.z < 0 && b.x + b.w / 2 > 48 && b.x - b.w / 2 < 56);
    expect(blocking).toEqual([]);
  });

  it("wears whole storeys of the map's facades, and towers step back at the top", () => {
    for (const b of boxes) expect((b.h - 0.6) / 3.2).toBeCloseTo(Math.round((b.h - 0.6) / 3.2));
    expect(new Set(boxes.map((b) => b.style))).toEqual(new Set(["residential", "office", "industrial"]));
    expect(boxes.some((b) => b.top && !b.top.plant)).toBe(true);
    expect(boxes.some((b) => b.top?.plant)).toBe(true);
    const group = buildOutskirts(boxes);
    expect(group.children.map((c) => c.name).sort()).toEqual([
      "outskirts-industrial",
      "outskirts-office",
      "outskirts-plant",
      "outskirts-residential",
    ]);
  });

  it("carries a varied city's slanted streets on out, with nothing standing on them", () => {
    const varied = generateVariedCity(1, { shape: "turned" });
    const streets = outskirtStreets(varied);
    expect(streets.length).toBeGreaterThan(8);
    expect(streets.some((s) => Math.abs(s.dx) > 0.2 && Math.abs(s.dz) > 0.2)).toBe(true);
    for (const b of placeOutskirts(varied, 3))
      for (const s of streets) {
        const t = (b.x - s.x) * s.dx + (b.z - s.z) * s.dz;
        if (t < 0) continue;
        const across = Math.abs((b.x - s.x) * s.dz - (b.z - s.z) * s.dx);
        expect(across).toBeGreaterThan(s.width / 2);
      }
  });

  it("lines its lots up with a turned city's streets, and keeps their corners off the map", () => {
    const varied = generateVariedCity(1, { shape: "turned" });
    const grain = streetGrain(varied);
    expect(Math.abs(grain)).toBeGreaterThan(0.2);
    const out = placeOutskirts(varied, 3);
    expect(out.length).toBeGreaterThan(100);
    for (const b of out) {
      expect(b.yaw).toBeCloseTo(-grain);
      const reach = Math.hypot(b.w, b.d) / 2;
      expect(Math.hypot(Math.max(-b.x, b.x - varied.width, 0), Math.max(-b.z, b.z - varied.height, 0))).toBeGreaterThan(reach);
    }
    // Square to the map on the classic grid, as before.
    expect(streetGrain(map)).toBeCloseTo(0);
    expect(boxes.every((b) => b.yaw === undefined)).toBe(true);
  });

  it("stands past the ring of city drawn round a generated map, and leaves from its streets", () => {
    const varied = generateVariedCity(1);
    const ring = varied.decor!.ring;
    for (const b of placeOutskirts(varied, 3)) {
      const dx = Math.max(-ring - b.x, b.x - varied.width - ring, 0);
      const dz = Math.max(-ring - b.z, b.z - varied.height - ring, 0);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(OUTSKIRTS_NEAR - 20);
    }
    const streets = outskirtStreets(varied);
    expect(streets.length).toBeGreaterThan(8);
    for (const s of streets) {
      const onEdge = s.x < -ring + 1.5 || s.z < -ring + 1.5 || s.x > varied.width + ring - 1.5 || s.z > varied.height + ring - 1.5;
      expect(onEdge).toBe(true);
    }
  });

  it("is the same for the same seed and thins out with distance", () => {
    expect(placeOutskirts(map, 3)).toEqual(boxes);
    const dist = (b: { x: number; z: number }) => Math.hypot(Math.max(-b.x, b.x - map.width, 0), Math.max(-b.z, b.z - map.height, 0));
    const near = boxes.filter((b) => dist(b) < 120).length / (120 - OUTSKIRTS_NEAR);
    const far = boxes.filter((b) => dist(b) > 240).length / (OUTSKIRTS_FAR - 240);
    expect(near).toBeGreaterThan(far * 0.5);
    const meanH = (l: typeof boxes) => l.reduce((s, b) => s + b.h, 0) / l.length;
    expect(meanH(boxes.filter((b) => dist(b) < 120))).toBeGreaterThan(meanH(boxes.filter((b) => dist(b) > 240)));
  });
});

describe("weather", () => {
  it("is clear on the first day and the same for the same seed and day", () => {
    for (let seed = 1; seed < 40; seed++) expect(weatherFor(seed, 1)).toBe("clear");
    expect(weatherFor(4242, 5)).toBe(weatherFor(4242, 5));
  });

  it("brings every kind over a campaign, with clear days the most common", () => {
    const n: Record<string, number> = { clear: 0, overcast: 0, rain: 0, fog: 0 };
    for (let seed = 1; seed <= 200; seed++) for (let day = 2; day <= 13; day++) n[weatherFor(seed, day)]++;
    for (const k of ["overcast", "rain", "fog"]) expect(n[k]).toBeGreaterThan(100);
    expect(n.clear).toBeGreaterThan(n.overcast + n.rain);
  });

  it("arrives as a front, not as a switch", () => {
    const step = easeWeather(WEATHER.clear, WEATHER.rain, 1 / 60);
    expect(step.rain).toBeGreaterThan(0);
    expect(step.rain).toBeLessThan(0.05);
    let s = WEATHER.clear;
    for (let i = 0; i < 60 * 40; i++) s = easeWeather(s, WEATHER.rain, 1 / 60);
    expect(s.rain).toBeGreaterThan(0.99);
    expect(easeWeather(WEATHER.clear, WEATHER.fog, 1, 0)).toEqual(WEATHER.fog);
  });

  it("rains over the whole view at every zoom, not only in the middle", () => {
    const fov = (42 * Math.PI) / 180;
    for (const d of [22, 60, 120, 200, 320]) {
      const box = rainBox(d);
      // Half-width of the ground the camera sees at its target, widescreen.
      const halfView = d * Math.tan(fov / 2) * 1.9;
      expect(box.size / 2).toBeGreaterThan(halfView);
      // Drops stay below the camera's height (pitch 0.92 puts it at about 0.8 d).
      expect(box.height).toBeLessThan(Math.max(70.1, d * 0.8));
    }
    expect(rainBox(22)).toEqual({ size: 150, height: 70, scale: 1 });
    expect(rainBox(320).scale).toBeGreaterThan(5);
  });
});
