import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * A close view of an imported map, for art review: the base has to read as pavement with
 * parks in it, not as a lawn with buildings standing on it.
 *
 * Opt-in: `REAL_SHOT=1 pnpm test:e2e tests/e2e/osm-ground-shot.spec.ts`; the capture goes
 * to `docs/art/osm_ground.png`.
 */
test.skip(!process.env.REAL_SHOT, "set REAL_SHOT=1 to capture an imported map");

test("captures the ground of an imported map", async ({ page }) => {
  test.setTimeout(180_000);
  const { syntheticOverpass, syntheticTerrain } = await import("../../packages/world/tests/fixtures/osm");
  await page.route("**/api/interpreter", (route) => {
    const terrain = decodeURIComponent(route.request().postData() ?? "").includes('"natural"="water"');
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(terrain ? { elements: syntheticTerrain() } : syntheticOverpass()),
    });
  });
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-real").click();
  await expect(page.getByTestId("place-selected")).toHaveText("São Paulo · Sé");
  await page.getByTestId("start-real").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-credit")).toContainText("OpenStreetMap");

  const spot = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const c = g.sim.city;
    // Midday, so the capture is about surfaces rather than about the sun's angle.
    g.sim.state.tick += 5 * 60 * 10;
    const b = [...c.buildings].sort((a: { height: number }, x: { height: number }) => x.height - a.height)[0];
    const pts = b.footprint ?? [{ x: b.rect.x, y: b.rect.y }];
    const cx = pts.reduce((s: number, p: { x: number }) => s + p.x / pts.length, 0);
    const cy = pts.reduce((s: number, p: { y: number }) => s + p.y / pts.length, 0);
    g.renderer.rts.jumpTo(cx + 25, cy + 25);
    g.renderer.rts.goalDistance = 70;
    g.renderer.rts.distance = 70;
    g.renderer.rts.yaw = 0.4;
    g.renderer.rts.goalYaw = 0.4;
    return { buildings: c.buildings.length, blocksX: c.blocksX };
  });
  expect(spot.blocksX).toBe(0);
  expect(spot.buildings).toBeGreaterThan(80);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: "docs/art/osm_ground.png" });
});
