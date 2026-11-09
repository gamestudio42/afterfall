import { expect, test, type Page } from "@playwright/test";

type Win = { __afterfall: any };

async function startGame(page: Page, seed = "4242") {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill(seed);
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
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
  await expect(page.getByTestId("pop")).toHaveText("4", { timeout: 20_000 });
}

test("research buys a capability, and the ledger shows what the day cost", async ({ page }) => {
  await startGame(page);

  // Points are earned in play; the test grants them through the same API a long
  // campaign would use, then checks the UI and the simulation agree.
  await page.evaluate(() => (window as unknown as Win).__afterfall.sim.addResearch(12));
  await page.getByTestId("open-research").click();
  await expect(page.getByTestId("research")).toBeVisible();
  await expect(page.getByTestId("research-points")).toContainText("12");

  await expect(page.getByTestId("tech-cistern")).toBeDisabled(); // needs preserves
  await page.getByTestId("tech-preserves").click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as Win).__afterfall.sim.hasTech("preserves"))).toBe(true);
  await expect(page.getByTestId("tech-cistern")).toBeEnabled();
  await expect(page.getByTestId("research-points")).toContainText("8");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("research")).toBeHidden();

  await page.getByTestId("open-econ").click();
  await expect(page.getByTestId("economy")).toBeVisible();
  await expect(page.getByTestId("econ-food")).toBeVisible();
  await expect(page.getByTestId("econ-medicine")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("economy")).toBeHidden();
});
