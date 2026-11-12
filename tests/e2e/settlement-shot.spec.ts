import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any };

/**
 * Captures what the settlement looks like once it is more than the HQ: two buildings
 * taken over (a workshop and a shelter, each flying its flag and lit at the door) and
 * three picked clean, grey, with debris on their doorsteps.
 *
 * Opt-in: `SETTLEMENT_SHOT=1 pnpm test:e2e tests/e2e/settlement-shot.spec.ts`; the captures
 * go to `docs/art/settlement_day.png` and `docs/art/settlement_night.png`.
 */
test.skip(!process.env.SETTLEMENT_SHOT, "set SETTLEMENT_SHOT=1 to capture the settlement");

test("captures a settlement by day and by night", async ({ page }) => {
  test.setTimeout(180_000);
  // Captures show the game as a GPU draws it: bloom and grade forced on.
  await page.goto("/?post=on");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  await page.evaluate(() => (window as unknown as Win).__afterfall.command({ type: "setBase", building: 0 }));
  await expectPopulation(page, "4");

  const spot = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    const hq = sim.city.buildings[0];
    const near = sim.city.buildings
      .map((b: any, i: number) => ({
        b,
        i,
        d: Math.hypot(b.entrance.x - hq.entrance.x, b.entrance.y - hq.entrance.y),
      }))
      .filter(({ b }: any) => b.index !== 0 && b.height < 14)
      .sort((a: any, c: any) => a.d - c.d);
    sim.state.buildings[near[0].i].fn = "workshop";
    sim.state.buildings[near[1].i].fn = "shelter";
    for (const { i } of near.slice(2, 6)) {
      const st = sim.state.buildings[i];
      st.explored = true;
      st.searchProgress = st.searchTotal;
    }
    g.renderer.refreshBuildingColors();
    return { x: hq.entrance.x, y: hq.entrance.y };
  });

  const frame = async () => {
    await page.evaluate((t) => {
      const g = (window as unknown as Win).__afterfall;
      g.renderer.rts.jumpTo(t.x, t.y + 14);
      g.renderer.rts.goalDistance = 85;
      g.renderer.rts.distance = 85;
      g.renderer.rts.yaw = 0.35;
      g.renderer.rts.goalYaw = 0.35;
    }, spot);
    await page.waitForTimeout(1_600);
  };

  await frame();
  await page.screenshot({ path: "docs/art/settlement_day.png" });

  // 21:30 on day one: the settlement lights up, the city does not.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.state.tick += 14.5 * 60 * 10;
  });
  await page.waitForTimeout(2_200);
  await page.screenshot({ path: "docs/art/settlement_night.png" });
});
