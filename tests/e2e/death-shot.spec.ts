import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the death cloud: three infected dying side by side, pinned at
 * the middle of the cloud so the headless renderer cannot miss it.
 *
 * Opt-in: `DEATH_SHOT=1 pnpm test:e2e tests/e2e/death-shot.spec.ts`; the
 * capture goes to `docs/art/death.png`.
 */
test.skip(!process.env.DEATH_SHOT, "set DEATH_SHOT=1 to capture the death cloud");

test("captures the death cloud", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // The sheet arrives after the first frame, like every texture.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.renderer.vfx.deathReady as boolean), { timeout: 15_000 })
    .toBe(true);

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.renderer.rts.goalDistance = 34;
    g.renderer.rts.distance = 34;
    for (let i = 0; i < 3; i++) g.sim.emitFx("death", at.x + (i - 1) * 5, at.y);
    g.renderer.vfx.debugPin(0.35);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/art/death.png" });

  const visible = await page.evaluate(
    () => (window as unknown as Win).__afterfall.renderer.vfx.pool.filter((m: { visible: boolean }) => m.visible).length,
  );
  console.log("DEATH", visible);
  expect(visible).toBeGreaterThanOrEqual(3);
});
