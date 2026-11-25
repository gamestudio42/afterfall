import { expect, test, type Page } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any; __afterfallUi: any };

async function start(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("speed-0").click();
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__afterfall.command({ type: "setBase", building: 0 });
    w.__afterfallUi.getState().set({ guideDismissed: true });
  });
  await expectPopulation(page, "4");
}

async function publish(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__afterfall.sim.update(0, 0);
    const ui = w.__afterfallUi.getState();
    ui.set({ frame: ui.frame + 1 });
  });
}

test("community inspection exposes care needs, locates members and restores automatic orders", async ({ page }, info) => {
  await start(page);
  // Seed conditions to isolate presentation from infection rolls and meal timing.
  const member = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const [e] = [...g.sim.survivors()];
    e.health.hp = 35;
    e.survivor.infected = true;
    e.survivor.infection = 42;
    e.survivor.hunger = 50;
    e.survivor.manual = true;
    e.survivor.inside = g.sim.state.hq;
    return { id: e.id, name: e.survivor.name };
  });
  await page.getByTestId("select-community").click();
  await expect(page.getByTestId("community-summary")).toHaveText("Feridos: 1 · Infectados: 1 · Fome: 1");
  const row = page.getByTestId(`survivor-${member.id}`);
  await expect(row).toContainText("35/100");
  await expect(row).toContainText("Infectado · 42%");
  await expect(row).toContainText("Com fome");
  await expect(page.getByTestId("manual-care-hint")).toContainText("Ordens manuais: 1");
  if (process.env.COMMUNITY_SHOT) await page.screenshot({ path: info.outputPath("community.png") });

  await row.click();
  await expect(page.getByTestId("panel-title")).toHaveText(member.name);
  await expect(page.getByTestId("survivor-location")).toContainText("Dentro de:");
  await page.getByTestId("survivor-care").locator("summary").click();
  await expect(page.getByText("Mantenha remédios no estoque", { exact: false })).toBeVisible();
  await expect(page.getByTestId("survivor-care")).toContainText("tratamento ao amanhecer");
  await expect(page.getByTestId("survivor-care")).toContainText("próxima refeição");
  await page.getByTestId("survivor-care").locator("summary").click();
  await page.getByTestId("focus-survivor").click();
  expect(
    await page.evaluate((id) => {
      const g = (window as unknown as Win).__afterfall;
      const p = g.sim.state.entities.get(id).transform;
      return Math.hypot(g.renderer.rts.goalTarget.x - p.x, g.renderer.rts.goalTarget.z - p.y);
    }, member.id),
  ).toBeLessThan(0.01);
  if (process.env.COMMUNITY_SHOT) await page.screenshot({ path: info.outputPath("survivor.png") });
  await page.getByTestId("auto-work").click();
  await publish(page);
  await expect(page.getByTestId("manual-care-hint")).toBeHidden();
  expect(await page.evaluate((id) => (window as unknown as Win).__afterfall.sim.state.entities.get(id).survivor.manual, member.id)).toBe(
    false,
  );
  await page.getByTestId("back-community").click();
  await expect(page.getByTestId("community-summary")).toBeVisible();
  await expect(page.locator(".unit-row")).toHaveCount(4);
  // A retained selection must not present a dead entity as someone who can receive care.
  await page.evaluate((id) => {
    const w = window as unknown as Win;
    w.__afterfall.sim.state.entities.get(id).health.hp = 0;
    const ui = w.__afterfallUi.getState();
    ui.set({ frame: ui.frame + 1 });
  }, member.id);
  await expect(row).toBeHidden();
  await expect(page.locator(".unit-row")).toHaveCount(3);
});

test("dawn hands off to the current community paused, including a portrait layout", async ({ page }, info) => {
  await start(page);
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.state.tick = (24 * 60 - 60) * 10;
    g.sim.tick();
    g.step(1 / 60, 3);
    g.setSpeed(4);
  });
  await expect(page.getByTestId("dawn-report")).toBeVisible();
  await page.getByTestId("review-community").click();
  await expect(page.getByTestId("dawn-report")).toBeHidden();
  await expect(page.getByTestId("community-summary")).toBeVisible();
  const pause = await page.evaluate(() => {
    const w = window as unknown as Win;
    const before = w.__afterfall.sim.state.tick;
    w.__afterfall.step(0.1, 4);
    const ui = w.__afterfallUi.getState();
    return { before, after: w.__afterfall.sim.state.tick, speed: ui.speed, lastSpeed: ui.lastSpeed };
  });
  expect(pause.after).toBe(pause.before);
  expect(pause.speed).toBe(0);
  expect(pause.lastSpeed).toBe(4);
  // The ordinary Continue action still preserves a deliberately selected pause.
  await page.getByTestId("open-dawn").click();
  await page.getByTestId("close-dawn").click();
  expect(await page.evaluate(() => (window as unknown as Win).__afterfallUi.getState().speed)).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("open-panel").click();
  await expect(page.getByTestId("community-summary")).toBeVisible();
  await page.locator(".unit-row").first().click();
  await page.getByTestId("open-panel").click();
  await expect(page.getByTestId("focus-survivor")).toBeInViewport();
  await page.getByTestId("back-community").click();
  await page.getByTestId("open-panel").click();
  await expect(page.getByTestId("community-summary")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.COMMUNITY_SHOT) await page.screenshot({ path: info.outputPath("community-portrait.png") });
});
