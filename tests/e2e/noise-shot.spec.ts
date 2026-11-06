import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the noise ring of a pistol and a rifle, pinned past the middle of
 * the sheet so both waves are spread wide.
 *
 * Opt-in: `NOISE_SHOT=1 pnpm test:e2e tests/e2e/noise-shot.spec.ts`; the
 * capture goes to `docs/art/noise.png`.
 */
test.skip(!process.env.NOISE_SHOT, "set NOISE_SHOT=1 to capture the noise ring");

test("captures the noise ring", async ({ page }) => {
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
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.renderer.vfx.noiseReady as boolean), { timeout: 15_000 })
    .toBe(true);

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.renderer.rts.goalDistance = 150;
    g.renderer.rts.distance = 150;
    // A pistol (45 m) and a rifle (70 m) fired 40 m apart.
    g.sim.emitFx("noise", at.x - 20, at.y, at.x - 20, at.y, 45);
    g.sim.emitFx("noise", at.x + 20, at.y, at.x + 20, at.y, 70);
    g.renderer.vfx.debugPin(0.55);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/art/noise.png" });

  const visible = await page.evaluate(
    () => (window as unknown as Win).__afterfall.renderer.vfx.pool.filter((m: { visible: boolean }) => m.visible).length,
  );
  console.log("NOISE", visible);
  expect(visible).toBe(2);
});
