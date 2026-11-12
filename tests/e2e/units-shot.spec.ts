import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any };

/**
 * Checks that the survivor model replaced the capsules and takes a close-up, so
 * the silhouette can be judged instead of assumed.
 */
test("the survivor model replaces the capsule kit", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  const hq = await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim;
    const cx = sim.city.width / 2;
    const cy = sim.city.height / 2;
    let best = 0;
    let bd = Infinity;
    for (const b of sim.city.buildings) {
      const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
      if (d < bd) {
        bd = d;
        best = b.index;
      }
    }
    return best;
  });
  await page.evaluate((index) => (window as unknown as Win).__afterfall.command({ type: "setBase", building: index }), hq);
  await expectPopulation(page, "4");

  // Give the model time to load and the camera time to settle.
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.unitParts.length > 0, null, { timeout: 15_000 });
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.sim.hqEntrance();
    // Close enough that a 1.9 m survivor is more than a few pixels tall.
    g.renderer.rts.jumpTo(at.x, at.y);
    g.renderer.rts.goalDistance = 26;
    g.renderer.rts.distance = 26;
  });
  await page.waitForTimeout(2_000);

  const state = await page.evaluate(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return {
      parts: r.unitParts.length,
      fallbackVisible: r.unitFallback.map((m: { visible: boolean }) => m.visible),
      count: r.unitParts[0]?.count ?? -1,
      drawCalls: r.drawCalls,
    };
  });
  console.log("UNITS", JSON.stringify(state));
  expect(state.parts).toBeGreaterThan(0);
  expect(state.fallbackVisible).toEqual([false, false, false]);

  // Screenshots are for the art review, not for CI: the headquarters can sit
  // between the camera and the door, so the frame is taken from four sides and
  // the readable one wins. Opt in with UNITS_SHOT=1.
  test.skip(!process.env.UNITS_SHOT, "set UNITS_SHOT=1 to capture the survivors");
  for (const [i, yaw] of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].entries()) {
    await page.evaluate((y) => {
      const rts = (window as unknown as Win).__afterfall.renderer.rts;
      rts.yaw = y as number;
      rts.goalYaw = y as number;
    }, yaw);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `/tmp/unit_yaw${i}.png` });
  }
  await page.screenshot({ path: "docs/art/survivors.png" });
});
