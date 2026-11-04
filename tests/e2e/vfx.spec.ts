import { expect, test, type Page } from "@playwright/test";

/* Efeitos visuais: o renderer consome os mesmos `sim.fx` que o audio. */
type Win = { __afterfall: any };

async function startGame(page: Page) {
  await page.bringToFront();
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();
}

test("particles are born from the simulation event and fade when their life ends", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startGame(page);

  const before = await page.evaluate(() => (window as unknown as Win).__afterfall.renderer.vfx.active);
  expect(before).toBe(0);
  if (process.env.VFX_BASELINE) await page.screenshot({ path: process.env.VFX_BASELINE });

  // A death event at the centre of the screen must become a particle.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.sim.emitFx("death", at.x, at.y);
  });

  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.vfx.active > 0, null, {
    timeout: 5_000,
  });
  const alive = await page.evaluate(() => ({
    active: (window as unknown as Win).__afterfall.renderer.vfx.active,
    count: (window as unknown as Win).__afterfall.renderer.vfx.mesh.count as number,
    drawCalls: (window as unknown as Win).__afterfall.renderer.drawCalls as number,
  }));
  expect(alive.active).toBeGreaterThan(0);
  expect(alive.count).toBe(alive.active);
  expect(alive.drawCalls).toBeGreaterThan(0);

  // Captura opcional para documentacao: VFX_SHOT=/caminho.png pnpm test:e2e tests/e2e/vfx.spec.ts
  if (process.env.VFX_SHOT) await page.screenshot({ path: process.env.VFX_SHOT });

  // Sem novos eventos, tudo expira sozinho.
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.vfx.active === 0, null, {
    timeout: 10_000,
  });
  expect(errors, errors.join("\n")).toEqual([]);
});
