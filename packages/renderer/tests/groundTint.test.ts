import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TEXTURED_TINT } from "../src/cityMeshes";

/**
 * Mean colour of each map in public/art, in sRGB, measured from the PNGs the
 * manifest pins (asphalt, grass, concrete). If a map is regenerated, measure
 * again and update the tint: this test is what notices the drift.
 */
const MAP_MEAN = {
  asphalt: [84, 85, 89],
  grass: [82, 100, 45],
  concrete: [184, 179, 170],
} as const;

/** The colour each material had before it wore a map. */
const FLAT = { roads: 0x34363a, ground: 0x4a4d40, blocks: 0x8d897e };
const MAP_OF = { roads: "asphalt", ground: "grass", blocks: "concrete" } as const;

function textured(tint: number, mean: readonly number[]): number[] {
  const t = new THREE.Color(tint); // linear
  const m = new THREE.Color().setRGB(mean[0] / 255, mean[1] / 255, mean[2] / 255, THREE.SRGBColorSpace);
  const out = new THREE.Color(t.r * m.r, t.g * m.g, t.b * m.b);
  return out
    .getHex(THREE.SRGBColorSpace)
    .toString(16)
    .padStart(6, "0")
    .match(/../g)!
    .map((h) => parseInt(h, 16));
}

describe("ground tint under a map", () => {
  for (const key of ["roads", "ground", "blocks"] as const) {
    it(`${key} averages out to its flat colour once textured`, () => {
      const flat = new THREE.Color(FLAT[key]).getHex(THREE.SRGBColorSpace);
      // A tint multiplies, so it can only darken the map: where the flat colour
      // is brighter than the map's mean (the ground's blue, over green grass),
      // the best it can reach is the mean itself, with a white channel.
      const mean = MAP_MEAN[MAP_OF[key]];
      const want = [(flat >> 16) & 255, (flat >> 8) & 255, flat & 255].map((c, i) => Math.min(c, mean[i]));
      const got = textured(TEXTURED_TINT[key], mean);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(3);
    });
  }

  it("the roads are no longer black: the old flat colour under the map came to sRGB ~10", () => {
    const old = textured(FLAT.roads, MAP_MEAN.asphalt);
    const now = textured(TEXTURED_TINT.roads, MAP_MEAN.asphalt);
    expect(Math.max(...old)).toBeLessThan(16);
    expect(Math.min(...now)).toBeGreaterThan(45);
  });
});
