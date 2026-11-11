import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("defense joints use authored piers and damage reaches the surface shader", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text());
  });
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as any).__afterfall.renderer.structuresReady);
  const result = await page.evaluate(() => {
    const g = (window as any).__afterfall;
    cancelAnimationFrame(g.raf);
    const { sim, renderer: r } = g;
    const p = sim.city.parks[0].rect;
    const cx = Math.floor((p.x + p.w / 2) / 2),
      cy = Math.floor((p.y + p.h / 2) / 2);
    // Real structure instances: an L, a T, a straight run and a non-wall neighbour.
    const cells = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [0, -1],
      [0, -2],
      [2, -1],
      [2, -2],
      [4, 1],
    ];
    cells.forEach(([x, y], i) => {
      const kind = i === 9 ? "well" : "wall";
      const e = {
        id: 9000 + i,
        health: { hp: i === 3 ? 25 : 100, max: 100 },
        structure: {
          kind,
          cx: cx + x,
          cy: cy + y,
          cells: [sim.grid.index(cx + x, cy + y)],
          built: true,
          progress: 100,
          task: -1,
          output: {},
        },
      };
      sim.state.entities.set(e.id, e);
      sim.stampStructure(e);
    });
    sim.state.tick = 1800;
    r.rts.jumpTo((cx + 2) * 2, cy * 2);
    r.rts.distance = r.rts.goalDistance = 25;
    r.rts.yaw = r.rts.goalYaw = 0.5;
    r.render(0.016);
    r.renderFrame();
    const junctions = r.structureModels.get("wall_junction");
    const models = [...r.structureModels.values()] as any[];
    const damaged = models.find((m) => m.ids.includes(9003));
    const damage = damaged.parts[0].geometry.getAttribute("structureDamage").getX(damaged.ids.indexOf(9003));
    const matrix = junctions.parts[0].matrix.clone();
    junctions.parts[0].getMatrixAt(0, matrix);
    return { ids: junctions.ids, damage, scale: Math.hypot(...matrix.elements.slice(8, 11)), image: r.canvas.toDataURL("image/png") };
  });
  expect(result.ids).toEqual([9000, 9002]);
  expect(result.scale).toBeCloseTo(1);
  expect(result.damage).toBeCloseTo(0.75);
  expect(errors).toEqual([]);
  if (process.env.STRUCTURE_SHOT)
    await writeFile(info.outputPath("structure-joints.png"), Buffer.from(result.image.split(",")[1], "base64"));
});
