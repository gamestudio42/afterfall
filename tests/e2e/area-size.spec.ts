import { expect, test } from "@playwright/test";

/** 800 m is a choice. The picker still opens on 480 m, and only the larger area warns that it loads slower. */
test("the real-place picker offers 800 m and keeps 480 m selected", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-real").click();
  await expect(page.getByTestId("area-400")).toBeVisible();
  await expect(page.getByTestId("area-480")).toHaveClass(/active/);
  await expect(page.getByTestId("area-600")).toBeVisible();
  await expect(page.getByTestId("area-800")).toBeVisible();
  await expect(page.getByTestId("area-slow")).toHaveCount(0);
  await page.getByTestId("area-800").click();
  await expect(page.getByTestId("area-800")).toHaveClass(/active/);
  await expect(page.getByTestId("area-480")).not.toHaveClass(/active/);
  await expect(page.getByTestId("area-slow")).toBeVisible();
  await page.getByTestId("area-600").click();
  await expect(page.getByTestId("area-slow")).toHaveCount(0);
});
