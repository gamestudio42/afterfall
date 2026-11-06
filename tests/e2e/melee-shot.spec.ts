import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Captures the infected strike: five slashes on a ring of victims, pinned at
 * the fullest frame of the strip so the headless renderer cannot miss it.
 *
 * Opt-in: `MELEE_SHOT=1 pnpm test:e2e tests/e2e/melee-shot.spec.ts`; the
 * capture goes to `docs/art/melee.png`.
 */
test.skip(!process.env.MELEE_SHOT, "set MELEE_SHOT=1 to capture the infected strike");

test("captures the infected strike", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // The strip arrives after the first frame, like every texture.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.renderer.vfx.meleeReady as boolean), { timeout: 15_000 })
    .toBe(true);

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.renderer.rts.goalDistance = 34;
    g.renderer.rts.distance = 34;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const x = at.x + Math.cos(a) * 3;
      const y = at.y + Math.sin(a) * 3;
      g.sim.emitFx("melee", x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, x, y);
    }
    g.renderer.vfx.debugPin(0.45);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/art/melee.png" });

  const visible = await page.evaluate(
    () => (window as unknown as Win).__afterfall.renderer.vfx.pool.filter((m: { visible: boolean }) => m.visible).length,
  );
  console.log("MELEE", visible);
  expect(visible).toBeGreaterThanOrEqual(5);
});
