import { expect, test, type Page } from "@playwright/test";
import { expectPopulation } from "./helpers";

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
  await expectPopulation(page, "4");
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
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as Win).__afterfall.sim.hasTech("preserves")), { timeout: 15_000 })
    .toBe(true);
  // The panel re-renders on the 0.2s UI beat. On a software renderer where frames
  // can take a second each, this re-render can miss the old 15s window. Advance
  // frames deterministically and give the poll more time.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = (window as unknown as Win).__afterfall;
          g.step(1 / 60, 6);
          return document.querySelector('[data-testid="tech-cistern"]') as HTMLButtonElement | null;
        }),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  await expect.poll(() => page.getByTestId("tech-cistern").isEnabled(), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.getByTestId("research-points").textContent(), { timeout: 30_000 }).toContain("8");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("research")).toBeHidden();

  await page.getByTestId("open-econ").click();
  await expect(page.getByTestId("economy")).toBeVisible();
  await expect(page.getByTestId("econ-food")).toBeVisible();
  await expect(page.getByTestId("econ-medicine")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("economy")).toBeHidden();
});

test("the built structures wear their models, not the fallback box", async ({ page }) => {
  await startGame(page);
  // The structure kit arrives asynchronously; a missing or broken file silently keeps the box,
  // which is exactly the regression this guards. Asset loading is real I/O and can take
  // longer on a loaded software-WebGL CI runner.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.renderer.structuresReady), { timeout: 30_000 })
    .toBe(true);
  const parts = await page.evaluate(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    const kinds: string[] = [];
    for (const [kind, model] of r.structureModels) kinds.push(`${kind}:${model.parts.length}`);
    return kinds.sort();
  });
  // Check every gameplay model and both visual wall variants explicitly.
  expect(parts.map((entry) => entry.split(":")[0])).toEqual(["farm", "gate", "tower", "wall", "wall_junction", "wall_patch", "well"]);
  for (const entry of parts) expect(Number(entry.split(":")[1])).toBeGreaterThan(0);
});
