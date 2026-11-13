import { describe, expect, it } from "vitest";
import { ShadowCadence, snapToTexels } from "../src/shadowCadence";

describe("shadow cadence", () => {
  it("redraws the first frame, then every other frame while the view holds", () => {
    const c = new ShadowCadence();
    const due = Array.from({ length: 6 }, () => c.due(10, 10, 120));
    expect(due).toEqual([true, false, true, false, true, false]);
  });

  it("redraws at once when the shadow camera moves or resizes", () => {
    const c = new ShadowCadence();
    c.due(0, 0, 120);
    expect(c.due(2, 0, 120)).toBe(false);
    const after = new ShadowCadence();
    after.due(0, 0, 120);
    expect(after.due(7, 0, 120)).toBe(true);
    const zoom = new ShadowCadence();
    zoom.due(0, 0, 120);
    expect(zoom.due(0, 0, 140)).toBe(true);
  });

  it("redraws after invalidate", () => {
    const c = new ShadowCadence();
    c.due(0, 0, 120);
    c.invalidate();
    expect(c.due(0, 0, 120)).toBe(true);
  });
});

describe("snapToTexels", () => {
  const s = Math.SQRT1_2;
  const right = { x: s, y: 0, z: -s };
  // Unit and orthogonal to right, as a light camera's axes are.
  const n = Math.sqrt(0.75);
  const up = { x: (s * 0.5) / n, y: s / n, z: (s * 0.5) / n };

  it("lands on whole texels along the light axes", () => {
    const p = snapToTexels({ x: 13.37, y: 0, z: -4.21 }, right, up, 0.25);
    const r = p.x * right.x + p.y * right.y + p.z * right.z;
    const u = p.x * up.x + p.y * up.y + p.z * up.z;
    expect(Math.abs(r / 0.25 - Math.round(r / 0.25))).toBeLessThan(1e-9);
    expect(Math.abs(u / 0.25 - Math.round(u / 0.25))).toBeLessThan(1e-9);
  });

  it("moves the centre by less than a texel", () => {
    const c = { x: 51.9, y: 0, z: 18.03 };
    const p = snapToTexels(c, right, up, 0.3);
    expect(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)).toBeLessThan(0.3);
  });
});
