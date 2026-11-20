import { expect, test } from "@playwright/test";
import { syntheticOverpass, syntheticTerrain } from "../../packages/world/tests/fixtures/osm";

/**
 * Loading a real place shows where it stands: each step, the server being asked, and a
 * way out. It used to be one fixed sentence for up to two minutes.
 */
test("loading a real place lists its steps and the server it is asking", async ({ page }) => {
  // The main server is busy; the second answers after a moment.
  await page.route("**://overpass-api.de/**", (route) => route.fulfill({ status: 502, body: "busy" }));
  await page.route("**://maps.mail.ru/**", async (route) => {
    const water = decodeURIComponent(route.request().postData() ?? "").includes('"natural"="water"');
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(water ? { elements: syntheticTerrain() } : syntheticOverpass()),
    });
  });
  await page.route("**/elevation-tiles-prod/**", (route) => route.abort());
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-real").click();
  await page.getByTestId("start-real").click();
  const map = page.getByTestId("load-map");
  await expect(map).toHaveAttribute("data-state", "active");
  await expect(map).toContainText("maps.mail.ru");
  await expect(page.getByTestId("load-elapsed")).toBeVisible();
  await expect(map).toHaveAttribute("data-state", "done");
  // No elevation: the relief is skipped, and the map loads flat.
  await expect(page.getByTestId("load-relief")).toHaveAttribute("data-state", "skipped");
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 60_000 });
});

test("a slow download can be cancelled", async ({ page }) => {
  await page.route("**/api/interpreter", async (route) => {
    await new Promise((r) => setTimeout(r, 15_000));
    await route.fulfill({ status: 502, body: "busy" }).catch(() => undefined);
  });
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-real").click();
  await page.getByTestId("start-real").click();
  await expect(page.getByTestId("load-map")).toHaveAttribute("data-state", "active");
  await page.getByTestId("cancel-real").click();
  await expect(page.getByTestId("load-steps")).toBeHidden();
  await expect(page.getByTestId("start-real")).toBeEnabled();
});
