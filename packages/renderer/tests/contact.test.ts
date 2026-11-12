import { describe, expect, it } from "vitest";
import type { BuildingDef } from "@afterfall/world";
import { CONTACT_STRENGTH, buildContactShadows } from "../src/contact";

function building(index: number, height: number, holes?: { x: number; y: number }[][]): BuildingDef {
  return {
    id: `b${index}`,
    index,
    type: "house" as BuildingDef["type"],
    zone: "residential" as BuildingDef["zone"],
    rect: { x: 0, y: 0, w: 20, h: 20 },
    holes,
    area: 400,
    floors: 2,
    height,
    entrance: { x: 10, y: -1 },
    facing: { x: 0, y: -1 },
  };
}

function read(mesh: ReturnType<typeof buildContactShadows>) {
  const pos = mesh.geometry.getAttribute("position");
  const col = mesh.geometry.getAttribute("color");
  const out: { x: number; y: number; z: number; a: number }[] = [];
  for (let i = 0; i < pos.count; i++) out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), a: col.getW(i) });
  return out;
}

describe("contact shadows", () => {
  it("is dark at the wall and fades to nothing outside it", () => {
    const v = read(buildContactShadows([building(0, 7)]));
    const onWall = v.filter((p) => p.a > 0);
    const outside = v.filter((p) => p.a === 0);
    expect(onWall.length).toBeGreaterThan(0);
    for (const p of onWall) {
      expect(p.a).toBeCloseTo(CONTACT_STRENGTH, 5);
      expect(p.x >= -1e-6 && p.x <= 20 + 1e-6 && p.z >= -1e-6 && p.z <= 20 + 1e-6).toBe(true);
    }
    for (const p of outside) expect(p.x < -1 || p.x > 21 || p.z < -1 || p.z > 21).toBe(true);
  });

  it("reaches farther from a taller building", () => {
    const reach = (h: number) => Math.max(...read(buildContactShadows([building(0, h)])).map((p) => p.x)) - 20;
    expect(reach(40)).toBeGreaterThan(reach(7));
  });

  it("darkens a courtyard inward", () => {
    const hole = [
      { x: 6, y: 6 },
      { x: 14, y: 6 },
      { x: 14, y: 14 },
      { x: 6, y: 14 },
    ];
    const plain = read(buildContactShadows([building(0, 7)])).length;
    const v = read(buildContactShadows([building(0, 7, [hole])]));
    expect(v.length).toBe(plain + 4 * 6);
    const inner = v.slice(plain).filter((p) => p.a === 0);
    for (const p of inner) expect(p.x > 6 && p.x < 14 && p.z > 6 && p.z < 14).toBe(true);
  });

  it("sits just above the pavement and writes no depth", () => {
    const mesh = buildContactShadows([building(0, 7)]);
    for (const p of read(mesh)) expect(p.y).toBeGreaterThan(0.06);
    expect((mesh.material as { depthWrite: boolean }).depthWrite).toBe(false);
  });
});
