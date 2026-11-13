import { expect, test, type Page } from "@playwright/test";

type Win = { __afterfall: any };

/** Drains the command queue without advancing time. */
const drain = (page: Page) => page.evaluate(() => (window as unknown as Win).__afterfall.sim.update(0, 0));

/** Screen position of a cell's centre, relative to the middle of the first park. */
async function cellOnScreen(page: Page, dx: number, dy: number) {
  return page.evaluate(
    ([x, y]) => {
      const g = (window as unknown as Win).__afterfall;
      const p = g.sim.city.parks[0].rect;
      const cx = Math.floor((p.x + p.w / 2) / 2) + x;
      const cy = Math.floor((p.y + p.h / 2) / 2) + y;
      return g.renderer.toScreen((cx + 0.5) * 2, (cy + 0.5) * 2, 0);
    },
    [dx, dy],
  );
}

const structures = (page: Page, kind: string) =>
  page.evaluate(
    (k) =>
      [...(window as unknown as Win).__afterfall.sim.structures()]
        .filter((e: Win["__afterfall"]) => e.structure.kind === k)
        .map((e: Win["__afterfall"]) => ({
          yaw: e.structure.line?.yaw ?? null,
          cells: e.structure.cells.length,
          replaces: e.structure.replaces ?? null,
          built: e.structure.built,
        })),
    kind,
  );

test("turning pieces, one click one piece, and a gate into a wall", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.structuresReady, null, { timeout: 60_000 });

  // A base, and the camera over the middle of a park: open ground on a generated city.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.enqueue({ type: "setBase", building: g.sim.city.buildings[0].index });
    g.sim.update(0, 0);
    const p = g.sim.city.parks[0].rect;
    g.renderer.rts.jumpTo(p.x + p.w / 2, p.y + p.h / 2);
    g.renderer.rts.distance = g.renderer.rts.goalDistance = 50;
  });
  await page.waitForFunction(() => {
    const g = (window as unknown as Win).__afterfall;
    const r = g.renderer.rts;
    const c = g.renderer.toScreen(r.target.x, r.target.z, 0);
    return Math.abs(c.x - g.canvas.clientWidth / 2) < 2 && Math.abs(c.y - g.canvas.clientHeight / 2) < 2;
  });

  // A wall line, drawn by dragging: the banner counts the pieces and their cost.
  await page.getByTestId("open-build").click();
  await page.getByTestId("build-wall").click();
  const a = await cellOnScreen(page, -3, 0);
  const b = await cellOnScreen(page, 3, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(page.getByTestId("build-cost")).toContainText("7");
  await expect(page.getByTestId("build-cost")).toContainText("14");
  await page.mouse.up();
  await drain(page);
  expect(await structures(page, "wall")).toHaveLength(7);

  // A lone wall turned with R twice: 30° off the grid. T hands the angle back.
  const lone = await cellOnScreen(page, 0, 4);
  await page.mouse.move(lone.x, lone.y, { steps: 2 });
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  await expect(page.getByTestId("build-rotate")).toContainText(/manual/);
  await page.mouse.click(lone.x, lone.y);
  await page.keyboard.press("t");
  await expect(page.getByTestId("build-rotate")).toContainText(/autom/);
  await drain(page);
  const walls = await structures(page, "wall");
  expect(walls).toHaveLength(8);
  expect(walls.filter((w) => w.yaw !== null).map((w) => w.yaw)).toEqual([expect.closeTo(Math.PI / 6, 3)]);

  // Finish the walls, then set a gate into the line with a click that wobbles.
  await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim;
    for (const e of sim.structures()) {
      e.structure.built = true;
      e.structure.task = -1;
      e.health = { hp: 600, max: 600 };
      sim.stampStructure(e);
    }
    sim.state.tasks.clear();
  });
  await page.keyboard.press("Escape");
  await page.getByTestId("build-gate").click();
  const mid = await cellOnScreen(page, 0, 0);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 3, mid.y - 2);
  await page.mouse.up();
  await drain(page);
  const gates = await structures(page, "gate");
  expect(gates).toHaveLength(1);
  expect(gates[0].replaces).not.toBeNull();
  // The wall stands until the gate is built.
  expect((await structures(page, "wall")).filter((w) => w.built)).toHaveLength(8);

  // A tower turned with R covers more than its four cells.
  await page.keyboard.press("Escape");
  await page.getByTestId("build-tower").click();
  const tower = await cellOnScreen(page, 0, -5);
  await page.mouse.move(tower.x, tower.y, { steps: 2 });
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  await page.mouse.click(tower.x, tower.y);
  await drain(page);
  const towers = await structures(page, "tower");
  expect(towers).toHaveLength(1);
  expect(towers[0].yaw).toBeCloseTo(Math.PI / 6, 3);
  expect(towers[0].cells).toBeGreaterThan(4);
  // Placing the tower left build mode; the next piece starts on automatic again.
  await expect(page.getByTestId("build-rotate")).toHaveCount(0);
  expect(errors).toEqual([]);
});
