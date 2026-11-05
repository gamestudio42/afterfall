import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the impact burst at four points of its life, pinned so the headless
 * renderer's frame rate cannot race the animation.
 *
 * Opt-in: `BURST_SHOT=1 pnpm test:e2e tests/e2e/burst-shot.spec.ts`.
 */
test.skip(!process.env.BURST_SHOT, "set BURST_SHOT=1 to capture the burst");

test("captures the burst across its life", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.renderer.rts.goalDistance = 70;
    g.renderer.rts.distance = 70;
    g.sim.emitFx("death", at.x, at.y);
  });
  await page.waitForTimeout(800);

  const frames = [0.1, 0.3, 0.55, 0.8];
  for (const [i, fraction] of frames.entries()) {
    await page.evaluate((f) => (window as unknown as Win).__afterfall.renderer.vfx.debugPin(f), fraction);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `/tmp/burst_${i}.png` });
  }

  const state = await page.evaluate(() => {
    const v = (window as unknown as Win).__afterfall.renderer.vfx;
    return { pool: v.pool.length, visible: v.pool.filter((m: { visible: boolean }) => m.visible).length };
  });
  console.log("BURST", JSON.stringify(state));
  expect(state.pool).toBeGreaterThan(0);
});
