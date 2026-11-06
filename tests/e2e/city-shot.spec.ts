import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the city by day and by night once the facade maps have loaded, for
 * art review. The night frame moves the clock to 22:00, so the settlement's
 * windows light up and every other building stays dark.
 *
 * Opt-in: `CITY_SHOT=1 pnpm test:e2e tests/e2e/city-shot.spec.ts`; the captures
 * go to `docs/art/city_day.png`, `docs/art/city_street.png` (close on a
 * door, the curbs and the sidewalk) and `docs/art/city_night.png`.
 */
test.skip(!process.env.CITY_SHOT, "set CITY_SHOT=1 to capture the city");

test("captures the city by day and by night", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // Base in the building nearest the centre, so the camera frames a lit HQ.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const cx = g.sim.city.width / 2;
    const cy = g.sim.city.height / 2;
    let best = 0;
    let bd = Infinity;
    for (const b of g.sim.city.buildings) {
      const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
      if (d < bd) {
        bd = d;
        best = b.index;
      }
    }
    g.command({ type: "setBase", building: best });
  });
  await expect(page.getByTestId("pop")).toHaveText("4", { timeout: 15_000 });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as Win).__afterfall.renderer.buildings.materials;
          const g = (window as unknown as Win).__afterfall.renderer;
          return !!(
            m.residential.map &&
            m.office.map &&
            m.roof.map &&
            m.residential.emissiveMap &&
            g.doors?.group.children[0].material.map
          );
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const b = g.sim.city.buildings[g.sim.state.hq];
    g.renderer.rts.jumpTo(b.entrance.x, b.entrance.y);
    g.renderer.rts.goalDistance = 55;
    g.renderer.rts.distance = 55;
  });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "docs/art/city_day.png" });

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    // The camera looks down toward -z, so a door facing +z is in view: frame
    // the one nearest the HQ.
    const hq = g.sim.city.buildings[g.sim.state.hq];
    let b = hq;
    let bd = Infinity;
    for (const o of g.sim.city.buildings) {
      if (o.facing.y <= 0.5) continue;
      const d = Math.hypot(o.entrance.x - hq.entrance.x, o.entrance.y - hq.entrance.y);
      if (d < bd) {
        bd = d;
        b = o;
      }
    }
    g.renderer.rts.jumpTo(b.entrance.x, b.entrance.y + 4);
    g.renderer.rts.goalDistance = 22;
    g.renderer.rts.distance = 22;
  });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "docs/art/city_street.png" });

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    // 22:00 on day 1: 15 game hours after the 07:00 start.
    g.sim.state.tick += 15 * 60 * 10;
  });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "docs/art/city_night.png" });

  const night = await page.evaluate(
    () => (window as unknown as Win).__afterfall.renderer.buildings.materials.residential.emissiveIntensity,
  );
  console.log("CITY night emissive", night);
  expect(night).toBeGreaterThan(0);
});
