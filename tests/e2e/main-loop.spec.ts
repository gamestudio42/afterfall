import { expect, test, type Page } from "@playwright/test";

/* The game exposes its controller on window for tests and diagnostics. */
type Win = { __afterfall: any };

async function startGame(page: Page, seed = "4242") {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill(seed);
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();
}

/** Screen position of a building's roof center, after centering the camera on it. */
async function buildingOnScreen(page: Page, index: number) {
  await page.evaluate((i) => {
    const g = (window as unknown as Win).__afterfall;
    const b = g.sim.city.buildings[i];
    g.renderer.rts.jumpTo(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2);
  }, index);
  await page.waitForTimeout(300);
  return page.evaluate((i) => {
    const g = (window as unknown as Win).__afterfall;
    const b = g.sim.city.buildings[i];
    return g.renderer.toScreen(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2, b.height);
  }, index);
}

test("start a game, choose a base, scavenge and save", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startGame(page);

  const hq = await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim;
    const cx = sim.city.width / 2;
    const cy = sim.city.height / 2;
    let best = 0;
    let bd = Infinity;
    for (const b of sim.city.buildings) {
      const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
      if (d < bd) {
        bd = d;
        best = b.index;
      }
    }
    return best;
  });
  const p = await buildingOnScreen(page, hq);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("set-base")).toBeVisible();
  await page.getByTestId("set-base").click();
  await expect(page.getByTestId("pop")).toHaveText("4");

  // Box-select the founding group around the door.
  const door = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const e = g.sim.hqEntrance();
    g.renderer.rts.jumpTo(e.x, e.y);
    return e;
  });
  await page.waitForTimeout(400);
  const d = await page.evaluate((e) => (window as unknown as Win).__afterfall.renderer.toScreen(e.x, e.y, 1), door);
  await page.mouse.move(d.x - 140, d.y - 140);
  await page.mouse.down();
  await page.mouse.move(d.x + 140, d.y + 140, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("panel-title")).toContainText("4");

  // Right-click the nearest other building to scavenge it.
  const target = await page.evaluate((h) => {
    const sim = (window as unknown as Win).__afterfall.sim;
    const e = sim.hqEntrance();
    let t = -1;
    let td = Infinity;
    for (const b of sim.city.buildings) {
      if (b.index === h) continue;
      const dd = Math.hypot(b.entrance.x - e.x, b.entrance.y - e.y);
      if (dd < td) {
        td = dd;
        t = b.index;
      }
    }
    return t;
  }, hq);
  const tp = await buildingOnScreen(page, target);
  await page.mouse.click(tp.x, tp.y, { button: "right" });
  await page.getByTestId("speed-4").click();

  await expect
    .poll(() => page.evaluate((t) => (window as unknown as Win).__afterfall.sim.state.buildings[t].searchProgress, target), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  await page.getByTestId("save").click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId("continue")).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("pop")).not.toHaveText("0");
  expect(errors).toEqual([]);
});

test("resolve a pending event while time is frozen", async ({ page }) => {
  await startGame(page, "4242");
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.command({ type: "setBase", building: 0 });
  });
  await expect(page.getByTestId("pop")).toHaveText("4");

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.sim.state.pendingEvent = { eventId: "radio", tick: g.sim.state.tick };
  });
  await expect(page.getByTestId("event-modal")).toBeVisible();
  // Give the loop a moment to observe the event, then prove the clock is frozen.
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => (window as unknown as Win).__afterfall.sim.state.tick);
  await page.waitForTimeout(300);
  const stillFrozen = await page.evaluate(() => (window as unknown as Win).__afterfall.sim.state.tick);
  expect(stillFrozen).toBe(before);

  await page.getByTestId("choice-0").click();
  await expect(page.getByTestId("event-modal")).toHaveCount(0);

  await page.getByTestId("speed-4").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__afterfall.sim.state.tick), { timeout: 10_000 })
    .toBeGreaterThan(stillFrozen);
});

test("build a wall from the build menu", async ({ page }) => {
  await startGame(page, "7");
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    g.command({ type: "setBase", building: 0 });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const e = g.sim.hqEntrance();
    g.renderer.rts.jumpTo(e.x, e.y);
  });
  await page.waitForTimeout(400);
  await page.getByTestId("open-build").click();
  await page.getByTestId("build-wall").click();
  const box = await page.locator("canvas:not(.minimap)").boundingBox();
  const cx = box!.width / 2;
  const cy = box!.height / 2 + 80;
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => [...(window as unknown as Win).__afterfall.sim.structures()].length), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("language can be switched to English", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByTestId("new-game")).toHaveText("New game");
});

test("the minimap moves the camera where it is clicked", async ({ page }) => {
  await startGame(page);
  const minimap = page.getByTestId("minimap");
  await expect(minimap).toBeVisible();
  const box = (await minimap.boundingBox())!;
  // Click near the top-left corner of the map.
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.2);
  await page.waitForTimeout(1500);
  const target = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    return { x: g.renderer.rts.target.x / g.sim.city.width, y: g.renderer.rts.target.z / g.sim.city.height };
  });
  expect(target.x).toBeCloseTo(0.15, 1);
  expect(target.y).toBeCloseTo(0.2, 1);
  await page.screenshot({ path: "test-results/minimap.png" });
});

test("start a game on a real place from OpenStreetMap (mocked)", async ({ page }) => {
  const { syntheticOverpass } = await import("../../packages/world/tests/fixtures/osm");
  let calls = 0;
  await page.route("**/api/interpreter", async (route) => {
    calls++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(syntheticOverpass()) });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("map-real").click();
  await expect(page.getByTestId("place-selected")).toHaveText("São Paulo · Sé");
  await page.getByTestId("start-real").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-credit")).toContainText("OpenStreetMap");
  const info = await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim;
    return { source: sim.city.source?.kind, buildings: sim.city.buildings.length, footprint: !!sim.city.buildings[0].footprint };
  });
  expect(info.source).toBe("osm");
  expect(info.buildings).toBeGreaterThan(80);
  expect(info.footprint).toBe(true);
  expect(calls).toBe(1);

  // Choose a base by clicking an imported building.
  const target = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const b = g.sim.city.buildings.find((x: { type: string }) => x.type === "house");
    const c = b.footprint.reduce(
      (s: { x: number; y: number }, p: { x: number; y: number }) => ({
        x: s.x + p.x / b.footprint.length,
        y: s.y + p.y / b.footprint.length,
      }),
      { x: 0, y: 0 },
    );
    g.renderer.rts.jumpTo(c.x, c.y);
    return { index: b.index, c, h: b.height };
  });
  await page.waitForTimeout(400);
  const p = await page.evaluate((t) => (window as unknown as Win).__afterfall.renderer.toScreen(t.c.x, t.c.y, t.h), target);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("set-base")).toBeVisible();
  await page.getByTestId("set-base").click();
  await expect(page.getByTestId("pop")).toHaveText("4");
  await page.screenshot({ path: "test-results/real-place.png" });

  // Saving keeps the map, so a reload continues on the same place.
  await page.getByTestId("save").click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("map-credit")).toContainText("São Paulo");
  expect(errors).toEqual([]);
});
