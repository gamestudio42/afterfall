import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * The task drawer is the priority lever: the assignment loop sorts tasks by priority, so
 * the arrow next to a task is the only way a player can say "this one first".
 */
test("the task drawer raises a task's priority", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // Base plus one wall blueprint, so the queue has a build task to reorder.
  const taskId = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.command({ type: "setBase", building: 0 });
    g.step(4);
    const hq = g.sim.city.buildings[g.sim.state.hq];
    const cell = g.sim.grid.cell;
    const cy = Math.floor(hq.entrance.y / cell) + (hq.facing.y > 0 ? 2 : -2);
    const cx = Math.floor(hq.entrance.x / cell);
    g.command({ type: "placeStructures", kind: "wall", cells: [[cx, cy]] });
    g.step(4);
    const task = [...g.sim.state.tasks.values()].find((t: any) => t.type === "build");
    return task ? task.id : -1;
  });
  expect(taskId).toBeGreaterThanOrEqual(0);

  await page.getByTestId("open-tasks").click();
  await expect(page.getByTestId("task-menu")).toBeVisible();
  const row = page.getByTestId(`task-${taskId}`);
  await expect(row).toBeVisible();

  const before = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    return [...g.sim.state.tasks.values()].find((t: any) => t.type === "build")!.priority;
  });
  await page.getByTestId(`task-up-${taskId}`).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const g = (window as unknown as Win).__afterfall;
          return [...g.sim.state.tasks.values()].find((t: any) => t.type === "build")!.priority;
        }),
      { timeout: 10_000 },
    )
    .toBe(before + 10);

  await page.getByTestId(`task-down-${taskId}`).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const g = (window as unknown as Win).__afterfall;
          return [...g.sim.state.tasks.values()].find((t: any) => t.type === "build")!.priority;
        }),
      { timeout: 10_000 },
    )
    .toBe(before);
});
