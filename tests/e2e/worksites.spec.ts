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

test("a wall job accounts for deliveries and inspects the unfinished piece, not the whole line", async ({ page }, info) => {
  await start(page);
  const job = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    const cell = sim.grid.cellOf(sim.hqEntrance().x, sim.hqEntrance().y);
    const hx = cell % sim.grid.cols,
      hy = Math.floor(cell / sim.grid.cols);
    let cells: number[][] | null = null;
    for (let y = hy - 8; y < hy + 8 && !cells; y++)
      for (let x = hx - 8; x < hx + 8 && !cells; x++)
        if (g.cellValid("wall", x, y, 0) && g.cellValid("wall", x + 1, y, 0))
          cells = [
            [x, y],
            [x + 1, y],
          ];
    if (!cells) throw new Error("No two-cell wall site near headquarters");
    g.command({ type: "placeStructures", kind: "wall", cells });
    sim.update(0, 0);
    const task = [...sim.state.tasks.values()].find((t: any) => t.type === "build");
    // Controlled half-built line: the first piece is complete, the second has not started.
    const first = sim.state.entities.get(task.structures[0]);
    first.structure.built = true;
    first.structure.progress = task.work / 2;
    first.health = { hp: 600, max: 600 };
    sim.stampStructure(first);
    task.progress = task.work / 2;
    task.delivered = { wood: 2 };
    task.inTransit = { wood: 1 };
    task.status = "blocked";
    sim.hqBuilding.storage.wood = 0;
    return { id: task.id, next: task.structures[1], first: first.id, priority: task.priority };
  });
  await page.getByTestId("open-tasks").click();
  const row = page.getByTestId(`task-${job.id}`);
  await expect(row).toContainText("Peças prontas: 1/2");
  await expect(row.getByTestId("job-progress")).toHaveText("50%");
  await expect(row.locator(".worksite-shortfall")).toContainText("Madeira 1");
  await page.getByTestId(`task-up-${job.id}`).click();
  await publish(page);
  expect(await page.evaluate((id) => (window as unknown as Win).__afterfall.sim.state.tasks.get(id).priority, job.id)).toBe(
    job.priority + 10,
  );
  if (process.env.WORKSITE_SHOT) await page.screenshot({ path: info.outputPath("task-queue.png") });

  await page.getByTestId(`task-focus-${job.id}`).click();
  await expect(page.getByTestId("task-menu")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Win).__afterfallUi.getState().selectedStructure)).toBe(job.next);
  await expect(page.getByTestId("piece-progress")).toHaveText("0%");
  await expect(page.getByTestId("job-progress")).toHaveText("50%");
  const materials = page.locator(".worksite-materials > div");
  await expect(materials.nth(0)).toContainText("Entregue à tarefa");
  await expect(materials.nth(0)).toContainText("Madeira 2");
  await expect(materials.nth(1)).toContainText("Madeira 1");
  await expect(materials.nth(2)).toContainText("Madeira 1");
  if (process.env.WORKSITE_SHOT) await page.screenshot({ path: info.outputPath("wall-progress.png") });
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await publish(page);
  expect(
    await page.evaluate(({ id, first, next }) => {
      const sim = (window as unknown as Win).__afterfall.sim;
      return { task: sim.state.tasks.has(id), first: sim.state.entities.get(first)?.structure.built, next: sim.state.entities.has(next) };
    }, job),
  ).toEqual({ task: false, first: true, next: false });
  await page.getByTestId("open-tasks").click();
  await expect(page.getByTestId(`task-${job.id}`)).toBeHidden();
  // Repair tasks live in the task map, not in a finished wall's production-task slot.
  const repairId = await page.evaluate((first) => {
    const g = (window as unknown as Win).__afterfall;
    const wall = g.sim.state.entities.get(first);
    wall.health.hp = wall.health.max / 2;
    for (let i = 0; i < 10; i++) g.sim.tick();
    const repair = [...g.sim.state.tasks.values()].find((t: any) => t.type === "repair" && t.structures.includes(first));
    return repair?.id ?? -1;
  }, job.first);
  expect(repairId).toBeGreaterThanOrEqual(0);
  await publish(page);
  await page.getByTestId(`task-focus-${repairId}`).click();
  await expect(page.getByTestId(`worksite-${repairId}`)).toBeVisible();
  await expect(page.getByTestId("piece-progress")).toBeHidden();
});

test("conversion feedback distinguishes night hours and worker availability on a narrow screen", async ({ page }, info) => {
  await start(page);
  const job = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    const def = sim.city.buildings.find((b: any) => b.index !== sim.state.hq && b.type === "house");
    if (!def) throw new Error("No house for the conversion fixture");
    const b = sim.state.buildings[def.index];
    b.explored = true;
    b.hiddenInfected = 0;
    g.command({ type: "convert", building: b.index, fn: "shelter" });
    sim.update(0, 0);
    sim.state.tick = (20 - 7) * 60 * 10;
    return { id: b.task, building: b.index };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("open-tasks").click();
  await expect(page.getByTestId(`task-${job.id}`).getByTestId("worksite-reason")).toContainText("Fora do horário");
  if (process.env.WORKSITE_SHOT) await page.screenshot({ path: info.outputPath("queue-portrait.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId(`task-focus-${job.id}`).click();
  await page.getByTestId("open-panel").click();
  expect(await page.evaluate(() => (window as unknown as Win).__afterfallUi.getState().selectedBuilding)).toBe(job.building);
  await expect(page.getByTestId("worksite-reason")).toContainText("Fora do horário");
  await page.evaluate(() => {
    (window as unknown as Win).__afterfall.sim.state.tick = 0;
  });
  await publish(page);
  await expect(page.getByTestId("worksite-reason")).toContainText("Aguardando trabalhadores");
  await page.getByRole("button", { name: "Revisar trabalhadores automáticos" }).click();
  await page.getByTestId("open-panel").click();
  await expect(page.getByTestId("community-summary")).toBeVisible();
});
