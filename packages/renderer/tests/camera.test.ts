import { describe, expect, it } from "vitest";
import { RtsCamera } from "../src/camera";

describe("camera on an 800 m place", () => {
  it("pans to the map edge and still zooms no further than 320 m", () => {
    const cam = new RtsCamera(16 / 9);
    expect(cam.maxDistance).toBe(320);
    cam.setBounds(0, 800, 0, 800);
    cam.jumpTo(400, 400);
    cam.pan(10_000, 0);
    cam.zoom(10);
    cam.update(10);
    expect(cam.target.x).toBeLessThanOrEqual(800);
    expect(cam.target.x).toBeGreaterThan(700);
    expect(cam.target.z).toBeGreaterThanOrEqual(0);
    expect(cam.target.z).toBeLessThanOrEqual(800);
    expect(cam.distance).toBeCloseTo(320, 0);
  });
});
