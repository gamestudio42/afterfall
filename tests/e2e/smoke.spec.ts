import { expect, test } from "@playwright/test";

/** Cross-browser smoke test: the shell boots and reaches the first game screen. */
test("boots the menu and starts a generated game", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await page.waitForTimeout(1_000);
  expect(errors, errors.join("\n")).toEqual([]);
  await expect(page.getByTestId("new-game")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();
  expect(errors).toEqual([]);
});
