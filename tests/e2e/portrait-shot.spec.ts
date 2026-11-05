import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the survivor panel with its portrait, and checks the renderer really
 * produced an image rather than an empty canvas.
 *
 * Opt-in: `PORTRAIT_SHOT=1 pnpm test:e2e tests/e2e/portrait-shot.spec.ts`.
 */
test.skip(!process.env.PORTRAIT_SHOT, "set PORTRAIT_SHOT=1 to capture the portrait");

test("renders a survivor portrait", async ({ page }) => {
  test.setTimeout(180_000);
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
  await expect(page.getByTestId("pop")).toHaveText("4", { timeout: 15_000 });

  // Wait for the model, then select one survivor so the panel opens.
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.unitParts.length > 0, null, {
    timeout: 30_000,
  });
  // Selection lives in the UI store, not in a simulation command.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const first = [...g.sim.survivors()][0];
    (window as unknown as { __afterfallUi?: { setState: (p: unknown) => void } }).__afterfallUi?.setState({
      selectedUnits: [first.id],
    });
    g.step(1 / 60, 4);
  });
  await page.waitForTimeout(500);

  const portrait = await page.evaluate(() => (window as unknown as Win).__afterfall.renderer.survivorPortrait());
  console.log("PORTRAIT", portrait ? `${portrait.slice(0, 24)}… ${portrait.length} chars` : "null");
  expect(portrait).toBeTruthy();
  await page.screenshot({ path: "docs/art/portrait.png" });
});
