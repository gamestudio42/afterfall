import { overpassQuery } from "@afterfall/world";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { ptBR } from "../i18n/pt-BR";
import { AREA_SIZES, DEFAULT_AREA_SIZE, placeCacheKey, serverTimeoutMs } from "./osm";

describe("real-place area sizes", () => {
  it("offers 800 m and keeps 480 m as the default", () => {
    expect(AREA_SIZES).toEqual([400, 480, 600, 800]);
    expect(DEFAULT_AREA_SIZE).toBe(480);
    expect(AREA_SIZES).toContain(DEFAULT_AREA_SIZE);
    expect(en["osm.areaSlow"]).toBeTruthy();
    expect(ptBR["osm.areaSlow"]).toBeTruthy();
    expect(ptBR["osm.areaSlow"]).not.toBe(en["osm.areaSlow"]);
  });

  it("keys each download by its side and waits past that query's timeout", () => {
    const lat = -22.9695;
    const lon = -43.1865;
    expect(placeCacheKey(lat, lon, 800)).toBe("-22.9695,-43.1865,800");
    expect(placeCacheKey(lat, lon, 800)).not.toBe(placeCacheKey(lat, lon, 600));
    expect(placeCacheKey(lat, lon, 800, "relief:")).toBe("relief:-22.9695,-43.1865,800");
    expect(placeCacheKey(lat, lon, 800, "terrain4:")).toBe("terrain4:-22.9695,-43.1865,800");
    expect(serverTimeoutMs(overpassQuery(lat, lon, 600))).toBe(45_000);
    expect(serverTimeoutMs(overpassQuery(lat, lon, 800))).toBe(76_000);
  });
});
