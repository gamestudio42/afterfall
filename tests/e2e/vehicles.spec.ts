import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("rendered abandoned cars and open doors have navigation collision", async ({ page }, info) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as any).__afterfall.renderer.propScene);
  const result = await page.evaluate(() => {
    const g = (window as any).__afterfall;
    cancelAnimationFrame(g.raf);
    const r = g.renderer;
    const cars = r.propScene.meshes.find((m: any) => m.name === "prop-car-surface_paint");
    const doors = r.propScene.meshes.find((m: any) => m.name === "vehicle-open-door-panel");
    const matrix = cars.matrix.clone();
    let blocked = 0;
    for (let i = 0; i < cars.count; i++) {
      cars.getMatrixAt(i, matrix);
      const x = matrix.elements[12],
        z = matrix.elements[14];
      if (!g.sim.grid.passable(x, z, "survivor") && !g.sim.grid.passable(x, z, "infected")) blocked++;
    }
    cars.getMatrixAt(0, matrix);
    r.rts.jumpTo(matrix.elements[12], matrix.elements[14]);
    r.rts.distance = r.rts.goalDistance = 23;
    r.rts.yaw = r.rts.goalYaw = -0.8;
    g.sim.state.tick = 1800;
    r.render(0.016);
    r.renderFrame();
    return { cars: cars.count, blocked, doors: doors.count, image: r.canvas.toDataURL("image/png") };
  });
  expect(result.cars).toBeGreaterThan(10);
  expect(result.blocked).toBe(result.cars);
  expect(result.doors).toBeGreaterThan(0);
  if (process.env.VEHICLE_SHOT) await writeFile(info.outputPath("abandoned-cars.png"), Buffer.from(result.image.split(",")[1], "base64"));
});
