import { expect, test, type Page } from "@playwright/test";
type Win = { __afterfall: any };

/** The shadow camera's half-extent, after a frame has run the lighting update. */
async function shadowHalf(page: Page, distance: number, expected: number): Promise<number> {
  await page.evaluate((d: number) => {
    const g = (window as unknown as Win).__afterfall;
    g.renderer.rts.distance = d;
    g.renderer.rts.goalDistance = d;
  }, distance);
  // Software GL in CI runs few frames a second: poll instead of assuming one has passed.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.renderer.sun.shadow.camera.right), {
      timeout: 8000,
      intervals: [100],
    })
    .toBe(expected);
  return expected;
}

test("the shadow camera covers what the camera can see", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-procedural").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press("Escape");

  // A fixed box left the far half of the screen unlit: buildings with a shadow on one side
  // and none on the other, which is what the sixth playtest report showed.
  const near = await shadowHalf(page, 60, 90);
  const far = await shadowHalf(page, 420, 340);
  expect(near).toBe(90);
  expect(far).toBe(340);

  // And it follows the camera, so the box is spent where the player is looking: the light
  // target is the camera's own target, every frame.
  const follows = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const a = g.renderer.sun.target.position;
    const b = g.renderer.rts.target;
    return Math.hypot(a.x - b.x, a.z - b.z);
  });
  expect(follows).toBeLessThan(1);
});
