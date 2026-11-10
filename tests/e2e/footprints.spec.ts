import { expect, test } from "@playwright/test";
type Win = { __afterfall: any };

test("the footprint overlay does not survive a new game", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?feet=1");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-procedural").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const feet = g.renderer.scene.children.filter((o: any) => o.name === "feet");
    return { overlays: feet.length, verts: feet[0]?.geometry.attributes.position.count ?? 0 };
  });
  const after = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.newGame(4242);
    const feet = g.renderer.scene.children.filter((o: any) => o.name === "feet");
    const built = g.sim.city.buildings.reduce((s: number, b: any) => s + (b.footprint?.length ?? 4), 0);
    return { overlays: feet.length, verts: feet[0]?.geometry.attributes.position.count ?? 0, expected: built * 2 };
  });
  console.log("FEET", JSON.stringify({ before, after }));
  expect(after.overlays).toBe(1);
  expect(after.verts).toBe(after.expected);
});
