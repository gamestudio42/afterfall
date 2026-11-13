import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any };

/**
 * Captures all screenshots referenced in README.md, showing the current game
 * with recent features: survivor/infected models, urban kit, night lighting,
 * rubble clouds, straight walls, campaign UI, etc.
 *
 * Opt-in: `README_SHOTS=1 pnpm test:e2e tests/e2e/readme-screenshots.spec.ts`
 *
 * Saves to `docs/screenshots/`:
 * - menu.jpg: main menu
 * - day.jpg: headquarters during the day with flag, stock bar, minimap
 * - real-place.jpg: real place picker interface
 * - scavenge.jpg: scavenging/search interface
 * - build.jpg: build menu
 * - night.jpg: night scene with lit headquarters and approaching horde
 * - horde.jpg: infected in the street near headquarters
 */
test.skip(!process.env.README_SHOTS, "set README_SHOTS=1 to capture README screenshots");

test("captures all README screenshots", async ({ page }) => {
  test.setTimeout(240_000);

  // 1. MENU SCREENSHOT
  // Captures show GPU-quality rendering with bloom and grade
  await page.goto("/?post=on");
  await expect(page.getByTestId("new-game")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800); // Let animations settle
  await page.screenshot({ path: "docs/screenshots/menu.jpg", quality: 85 });
  console.log("✓ Captured menu.jpg");

  // 2. REAL PLACE PICKER SCREENSHOT
  await page.getByTestId("new-game").click();
  await expect(page.getByTestId("map-real")).toBeVisible();
  await page.getByTestId("map-real").click();
  await expect(page.getByTestId("place-selected")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/real-place.jpg", quality: 85 });
  console.log("✓ Captured real-place.jpg");

  // Go back and start a generated city
  await page.getByTestId("map-procedural").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // Pick a central headquarters
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
  await page.evaluate((index) => (window as unknown as Win).__afterfall.command({ type: "setBase", building: index }), hq);
  await expectPopulation(page, "4");

  // 3. DAY SCREENSHOT - headquarters with survivors clearly visible
  // Position camera closer to show survivor character models doing something
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.sim.hqEntrance();
    // Closer zoom so survivors are clearly visible while still showing base + HUD
    g.renderer.rts.jumpTo(at.x, at.y + 5);
    g.renderer.rts.goalDistance = 40;
    g.renderer.rts.distance = 40;
    g.renderer.rts.yaw = 0.35;
    g.renderer.rts.goalYaw = 0.35;
  });
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer.rts;
    return Math.abs(r.distance - r.goalDistance) < 0.05 && r.target.distanceTo(r.goalTarget) < 0.05;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/day.jpg", quality: 85 });
  console.log("✓ Captured day.jpg");

  // 4. SCAVENGE SCREENSHOT - show search interface on a building
  // Find a nearby building to search
  const nearbyBuilding = await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim;
    const hqPos = sim.hqEntrance();
    const nearby = sim.city.buildings
      .filter((b: any) => b.index !== sim.state.base && b.height < 20)
      .map((b: any) => ({
        i: b.index,
        d: Math.hypot(b.entrance.x - hqPos.x, b.entrance.y - hqPos.y),
      }))
      .sort((a: any, c: any) => a.d - c.d)[0];
    return nearby.i;
  });

  // Select a survivor and click on the building to show search interface
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const survivor = [...g.sim.survivors()][0];
    g.command({ type: "select", ids: [survivor.id] });
  });

  await page.evaluate((buildingIndex) => {
    const g = (window as unknown as Win).__afterfall;
    const building = g.sim.city.buildings[buildingIndex];
    g.command({
      type: "orderSearch",
      building: buildingIndex,
      x: building.entrance.x,
      y: building.entrance.y,
    });
  }, nearbyBuilding);

  await page.waitForTimeout(1500); // Let the search UI appear
  await page.screenshot({ path: "docs/screenshots/scavenge.jpg", quality: 85 });
  console.log("✓ Captured scavenge.jpg");

  // Close any dialogs
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5. BUILD MENU SCREENSHOT
  await page.getByTestId("open-build").click();
  await expect(page.getByTestId("build-menu")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/build.jpg", quality: 85 });
  console.log("✓ Captured build.jpg");

  // Close build menu (important: night.jpg and horde.jpg must NOT show it)
  await page.getByTestId("open-build").click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("build-menu")).not.toBeVisible();

  // 6. NIGHT SCREENSHOT - infected visibly approaching the lit base
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    // Calibrate ticks -> game minutes from simulation
    sim.state.tick = 0;
    const h0 = sim.clock.hourFloat;
    sim.state.tick = 1000;
    const h1 = sim.clock.hourFloat;
    const ticksPerMinute = 1000 / Math.max(0.001, (h1 - h0) * 60);
    // Advance to 21:30 (night horde time)
    sim.state.tick = Math.max(0, Math.round((21.5 * 60 - h0 * 60) * ticksPerMinute));
  });

  // Spawn a visible horde approaching from the east
  const spawned = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    const at = sim.hqEntrance();

    // Spawn 8-10 infected in a visible group approaching from the east
    // Closer to base and tighter formation so they're clearly visible
    for (let i = 0; i < 10; i++) {
      const kind = i % 3 === 0 ? "brute" : i % 3 === 1 ? "runner" : "walker";
      const row = Math.floor(i / 3);
      const col = i % 3;
      sim.spawnInfected(kind, at.x + 12 + col * 2.5, at.y - 2 + row * 2, -1);
    }

    // Step simulation so they walk toward the base
    g.step(1 / 60, 40);

    // Position camera to show both the lit base and approaching infected
    g.renderer.rts.jumpTo(at.x + 6, at.y + 2);
    g.renderer.rts.goalDistance = 55;
    g.renderer.rts.distance = 55;
    g.renderer.rts.yaw = 0.3;
    g.renderer.rts.goalYaw = 0.3;

    return { infected: [...sim.infected()].length, hour: sim.clock.hourFloat };
  });
  console.log("NIGHT", JSON.stringify(spawned));

  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer.rts;
    return Math.abs(r.distance - r.goalDistance) < 0.05 && r.target.distanceTo(r.goalTarget) < 0.05;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/night.jpg", quality: 85 });
  console.log("✓ Captured night.jpg");

  // 7. HORDE SCREENSHOT - several infected models clearly visible
  // Spawn additional infected for a better close-up group shot
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    const at = sim.hqEntrance();

    // Add more infected in the foreground for a clear horde shot
    // Mix of types, positioned for good visibility of character models
    const positions = [
      { x: at.x + 8, y: at.y - 1, kind: "walker" },
      { x: at.x + 10, y: at.y - 2, kind: "brute" },
      { x: at.x + 12, y: at.y - 1, kind: "runner" },
      { x: at.x + 9, y: at.y + 1, kind: "walker" },
      { x: at.x + 11, y: at.y, kind: "walker" },
      { x: at.x + 7, y: at.y - 2, kind: "runner" },
      { x: at.x + 10, y: at.y + 2, kind: "brute" },
    ];

    for (const pos of positions) {
      sim.spawnInfected(pos.kind, pos.x, pos.y, -1);
    }

    // Step simulation to animate them
    g.step(1 / 60, 30);

    // Position camera for a clear shot of the horde - closer, readable models
    g.renderer.rts.jumpTo(at.x + 10, at.y);
    g.renderer.rts.goalDistance = 22;
    g.renderer.rts.distance = 22;
    g.renderer.rts.yaw = 0.45;
    g.renderer.rts.goalYaw = 0.45;
  });

  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer.rts;
    return Math.abs(r.distance - r.goalDistance) < 0.05 && r.target.distanceTo(r.goalTarget) < 0.05;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/horde.jpg", quality: 85 });
  console.log("✓ Captured horde.jpg");

  console.log("✅ All README screenshots captured successfully");
});
