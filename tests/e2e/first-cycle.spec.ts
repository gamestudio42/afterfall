import { expect, test, type Page } from "@playwright/test";

type Win = { __afterfall: any; __afterfallUi: any };

// Exercise the actual first-run default, rather than the classic-grid regression fixture.
test.use({ storageState: { cookies: [], origins: [] } });

async function start(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("speed-0").click();
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const center = { x: g.sim.city.width / 2, y: g.sim.city.height / 2 };
    const b = [...g.sim.city.buildings].sort(
      (a: any, b: any) =>
        Math.hypot(a.entrance.x - center.x, a.entrance.y - center.y) - Math.hypot(b.entrance.x - center.x, b.entrance.y - center.y),
    )[0];
    g.command({ type: "setBase", building: b.index });
    g.step(1 / 60, 1);
  });
  await expect(page.getByTestId("pop")).toHaveText("4");
}

test("the default city teaches selection, shows markers, and remembers dismissed guidance", async ({ page }, info) => {
  // Two medium varied-city boots, including a save reload, share this budget.
  test.setTimeout(180_000);
  await start(page);
  await expect(page.getByTestId("guide-step")).toHaveText("Encontre sua comunidade");
  await page.getByTestId("guide-select").click();
  await expect(page.getByTestId("panel-title")).toContainText("4");
  await expect(page.getByTestId("guide-step")).toHaveText("Escolha a primeira exploração");
  const marker = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.renderer.render(0);
    const r = g.renderer.survivorMarkers;
    return { generated: !!g.sim.city.generated, count: r.count, depthTest: r.material.depthTest, depthWrite: r.material.depthWrite };
  });
  expect(marker).toEqual({ generated: true, count: 4, depthTest: false, depthWrite: false });
  if (process.env.FIRST_CYCLE_SHOT) await page.screenshot({ path: info.outputPath("first-day.png") });
  await page.getByTestId("dismiss-guide").click();
  await expect(page.getByTestId("first-cycle")).toBeHidden();
  await page.getByTestId("save").click();
  await expect(page.getByText("Jogo salvo", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("pop")).toHaveText("4");
  await expect(page.getByTestId("first-cycle")).toBeHidden();
  await page.getByRole("button", { name: "Ajuda", exact: true }).click();
  await page.getByRole("button", { name: "Mostrar orientação do primeiro dia" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("first-cycle")).toBeVisible();
});

test("a rejected tower keeps its tool and explains the doorway before a valid placement", async ({ page }, info) => {
  await start(page);
  await page.getByTestId("dismiss-guide").click();
  const targets = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const p = g.sim.hqEntrance();
    const grid = g.sim.grid;
    const index = grid.cellOf(p.x, p.y);
    const cx = index % grid.cols;
    const cy = Math.floor(index / grid.cols);
    let good: number[] | null = null;
    for (let dy = -6; dy <= 6 && !good; dy++)
      for (let dx = -6; dx <= 6 && !good; dx++) if (g.cellValid("tower", cx + dx, cy + dy, 0)) good = [cx + dx, cy + dy];
    if (!good) throw new Error("No nearby tower site");
    g.renderer.rts.jumpTo(p.x, p.y);
    g.renderer.rts.distance = g.renderer.rts.goalDistance = 70;
    return { bad: [cx, cy], good, stock: g.sim.totals().wood };
  });
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer.rts;
    return r.target.distanceTo(r.goalTarget) < 0.05;
  });
  await page.getByTestId("open-build").click();
  await page.getByTestId("build-tower").click();
  // Fixed angle makes the clicked footprint match the inspected two-by-two cells.
  await page.evaluate(() => {
    (window as unknown as Win).__afterfall.buildYawKind = "tower";
    (window as unknown as Win).__afterfall.buildYaw = 0;
  });
  const at = async (cell: number[]) =>
    page.evaluate(([x, y]) => {
      const g = (window as unknown as Win).__afterfall;
      return g.renderer.toScreen((x + 1.5) * g.sim.grid.cell, (y + 1.5) * g.sim.grid.cell, 0);
    }, cell);
  let p = await at(targets.bad);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("build-rejection")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Win).__afterfallUi.getState().buildMode)).toBe("tower");
  expect(await page.evaluate(() => [...(window as unknown as Win).__afterfall.sim.structures()].length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Win).__afterfall.sim.totals().wood)).toBe(targets.stock);
  if (process.env.FIRST_CYCLE_SHOT) await page.screenshot({ path: info.outputPath("placement-rejected.png") });
  p = await at(targets.good);
  await page.mouse.click(p.x, p.y);
  // Drain the real queued pointer command without waiting for a software-rendered frame.
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__afterfall.sim.update(0, 0);
    const ui = w.__afterfallUi.getState();
    ui.set({ frame: ui.frame + 1 });
  });
  await expect.poll(() => page.evaluate(() => [...(window as unknown as Win).__afterfall.sim.structures()].length)).toBe(1);
  await expect(page.getByTestId("build-rejection")).toBeHidden();
  await page.getByTestId("open-tasks").click();
  await expect(page.getByTestId("task-menu")).toContainText("trabalhadores");
  await expect(page.getByTestId("task-menu")).not.toContainText("pending");
});

test("dawn pauses for a saved report, preserves player pause, and yields to events and defeat", async ({ page }, info) => {
  test.setTimeout(180_000);
  await start(page);
  // Advance the real hourly system through dawn; isolate this UI check from combat balance.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.state.tick = (24 * 60 - 60) * 10;
    g.sim.state.econ.delivered = { food: 8, wood: 12 };
    g.sim.state.econ.consumed = { water: 4 };
    g.sim.tick();
    g.step(1 / 60, 3);
  });
  await expect(page.getByTestId("dawn-report")).toBeVisible();
  await expect(page.getByTestId("dawn-report")).toContainText("Noite 1 superada");
  await expect(page.getByTestId("dawn-report")).toContainText("Madeira 12");
  await expect(page.getByTestId("open-econ")).toBeInViewport();
  await expect(page.getByTestId("volume")).toBeVisible();
  const tick = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.setSpeed(4);
    const before = g.sim.state.tick;
    g.step(0.1, 3);
    return { before, after: g.sim.state.tick };
  });
  expect(tick.after).toBe(tick.before);
  if (process.env.FIRST_CYCLE_SHOT) await page.screenshot({ path: info.outputPath("first-dawn.png") });
  await page.evaluate(() => (window as unknown as Win).__afterfall.setSpeed(0));
  await page.getByTestId("close-dawn").click();
  expect(await page.evaluate(() => (window as unknown as Win).__afterfallUi.getState().speed)).toBe(0);
  await page.getByTestId("save").click();
  await expect(page.getByText("Jogo salvo", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("dawn-report")).toBeHidden();
  await page.getByTestId("open-dawn").click();
  await expect(page.getByTestId("dawn-report")).toContainText("Madeira 12");
  await page.getByTestId("close-dawn").click();
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__afterfall.sim.state.pendingEvent = { eventId: "refugees", tick: w.__afterfall.sim.state.tick };
    const ui = w.__afterfallUi.getState();
    ui.set({ showDawn: true, frame: ui.frame + 1 });
  });
  await expect(page.getByTestId("dawn-report")).toBeHidden();
  await expect(page.getByTestId("event-modal")).toBeVisible();
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.state.pendingEvent = null;
    g.sim.state.outcome = { type: "defeat", reason: "hqDestroyed", tick: g.sim.state.tick };
    g.step(1 / 60, 3);
    const ui = (window as unknown as Win).__afterfallUi.getState();
    ui.set({ frame: ui.frame + 1 });
  });
  await expect(page.getByTestId("dawn-report")).toBeHidden();
  await expect(page.getByTestId("outcome")).toBeVisible();
});
