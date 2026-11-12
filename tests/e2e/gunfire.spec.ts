import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/**
 * Gunfire noise, drawn as a ring on the ground sized to the radius that pulls infected.
 *
 * The first version of this spec looked for a `RingGeometry` in the effect pool and a
 * "threat view" that only shows the ring — neither exists. The noise ring is a flat
 * billboard with the ring flipbook (decision 21), it is drawn whatever the overlay is, and
 * at the combat zoom its 45 m radius does not fit in the frame at all.
 */
test("gunfire draws a flash, a spark and a noise ring at the pull radius", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const v = (window as any).__afterfall.renderer.vfx;
    return v.muzzleReady && v.noiseReady && v.deathReady && v.dustReady;
  });

  const result = await page.evaluate(() => {
    const g = (window as any).__afterfall;
    cancelAnimationFrame(g.raf);
    const r = g.renderer;
    const v = r.vfx;
    const park = g.sim.city.parks[0].rect;
    const x = park.x + park.w / 2;
    const z = park.y + park.h / 2;
    r.rts.jumpTo(x, z);
    r.rts.distance = r.rts.goalDistance = 32;
    g.sim.state.tick = 1800;
    g.sim.emitFx("shot", x - 4, z, x + 6, z);
    g.sim.emitFx("noise", x - 4, z, x - 4, z, 45);
    g.sim.emitFx("hit", x + 6, z);
    v.debugPin(0.25);
    r.render(0.016);
    const bursts = v.bursts.map((b: any) => ({ look: b.look, size: b.size }));
    const ring = bursts.find((b: any) => b.look === "ring");
    const radius = (ring.size * v.ringFill) / 2;
    // A ring that lands within the merge distance of a live one is dropped, so a fight in
    // one street does not stack ten rings on top of each other.
    g.sim.emitFx("noise", x - 3, z, x - 3, z, 45);
    r.render(0.016);
    const ringsAfterMerge = v.bursts.filter((b: any) => b.look === "ring").length;
    const visibleAtCombat = v.pool.filter((m: any) => m.visible).length;
    const normalImage = r.canvas.toDataURL("image/png");
    // Pull back until the whole ring is in frame: at the combat zoom its edge is outside.
    r.rts.distance = r.rts.goalDistance = 150;
    r.render(0);
    const wideImage = r.canvas.toDataURL("image/png");
    // And it goes away on its own.
    v.debugPin(null);
    r.render(2);
    const alive = v.pool.filter((m: any) => m.visible).length;
    return { looks: bursts.map((b: any) => b.look), radius, ringsAfterMerge, visibleAtCombat, alive, normalImage, wideImage };
  });

  expect(result.looks).toEqual(["flash", "ring", "spark"]);
  expect(result.radius).toBeCloseTo(45, 0);
  expect(result.ringsAfterMerge).toBe(1);
  expect(result.visibleAtCombat).toBe(3);
  expect(result.alive).toBe(0);
  expect(errors).toEqual([]);

  if (process.env.GUNFIRE_SHOT) {
    for (const [name, data] of [
      ["gunfire-normal", result.normalImage],
      ["gunfire-threat", result.wideImage],
    ])
      await writeFile(info.outputPath(`${name}.png`), Buffer.from(data.split(",")[1], "base64"));
  }
});
