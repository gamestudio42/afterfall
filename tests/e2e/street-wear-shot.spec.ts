import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the street wear: the cracks, patches, oil, rubble, tufts and litter the decal
 * layer lays down, at the two zooms the game is actually played at (120 m, where the city
 * is read, and 60 m, where a street is read).
 *
 * Opt-in: `STREET_SHOT=1 pnpm test:e2e tests/e2e/street-wear-shot.spec.ts`; the captures go
 * to `docs/art/street_wear.png` and `docs/art/street_wear_close.png`.
 */
test.skip(!process.env.STREET_SHOT, "set STREET_SHOT=1 to capture the street wear");

test("captures the street wear at two zooms", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  await page.evaluate(() => (window as unknown as Win).__afterfall.command({ type: "setBase", building: 0 }));
  await expect(page.getByTestId("pop")).not.toHaveText("0", { timeout: 20_000 });

  // The wear layer is built with the map and its atlas streams in afterwards.
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.decals !== null, null, {
    timeout: 20_000,
  });
  const decals = await page.evaluate(
    () => (window as unknown as Win).__afterfall.renderer.decals.geometry.getAttribute("position").count / 4,
  );
  expect(decals).toBeGreaterThan(1000);

  const frame = async (distance: number, path: string) => {
    await page.evaluate((d) => {
      const g = (window as unknown as Win).__afterfall;
      g.renderer.rts.jumpTo(150, 204);
      g.renderer.rts.goalDistance = d;
      g.renderer.rts.distance = d;
      g.renderer.rts.yaw = 0.45;
      g.renderer.rts.goalYaw = 0.45;
    }, distance);
    await page.waitForTimeout(1_400);
    await page.screenshot({ path });
  };

  await frame(120, "docs/art/street_wear.png");
  await frame(60, "docs/art/street_wear_close.png");
});
