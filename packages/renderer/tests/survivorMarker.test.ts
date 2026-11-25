import { expect, it } from "vitest";
import { survivorMarkerScale } from "../src/survivorMarker";

it("keeps tactical markers readable as distance and viewport change without unbounded world size", () => {
  const normal = survivorMarkerScale(100, 42, 720);
  expect(survivorMarkerScale(200, 42, 720)).toBeCloseTo(normal * 2);
  expect(survivorMarkerScale(100, 42, 1440)).toBeCloseTo(normal / 2);
  expect(survivorMarkerScale(10000, 42, 720)).toBe(4);
  expect(survivorMarkerScale(0, 42, 720)).toBe(0.25);
  expect(Number.isFinite(survivorMarkerScale(100, 42, 0))).toBe(true);
});
