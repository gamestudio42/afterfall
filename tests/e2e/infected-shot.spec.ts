import { expect, test } from "@playwright/test";

type Win = { __afterfall: any };

/**
 * Checks that the infected model replaced the capsule, and captures the three
 * kinds side by side at night so the silhouette can be judged instead of
 * assumed.
 *
 * The check runs in CI; the capture is opt-in:
 * `INFECTED_SHOT=1 pnpm test:e2e tests/e2e/infected-shot.spec.ts` writes
 * `docs/art/infected.png`.
 */
test("the infected model replaces the capsule", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  // The model arrives with the first frames; the capsule draws until then.
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.infectedParts.length > 0, null, {
    timeout: 15_000,
  });

  const state = await page.evaluate(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return {
      morphs: r.infectedParts[0].geometry.morphAttributes.position.length,
      parts: r.infectedParts.length,
      tinted: r.infectedParts.filter((m: { instanceColor: unknown }) => m.instanceColor !== null).length,
      capsuleHidden: r.infected.visible === false,
      capsuleCount: r.infected.count,
      materials: [...new Set(r.infectedParts.map((m: { material: { name: string } }) => m.material.name))].sort(),
      drawn: r.infectedParts[0].count,
      morphCapacity: r.infectedParts[0].morphTexture.image.height,
      drawCalls: r.drawCalls,
    };
  });
  console.log("INFECTED", JSON.stringify(state));

  // Walk, run, idle, attack and hit keys share the batches.
  expect(state.morphs).toBe(26);
  expect(state.parts).toBe(6);
  expect(state.materials).toEqual(["cloth", "detail", "eyes", "hair", "pants", "skin"]);
  // Clothing, trousers, hair and skin vary independently; eyes and fixed details retain their colors.
  expect(state.tinted).toBe(4);
  expect(state.morphCapacity).toBe(600);
  expect(state.capsuleHidden).toBe(true);
  expect(state.capsuleCount).toBe(0);
  expect(state.drawn).toBeGreaterThan(0);

  // The capture is opt-in, so a heavy frame job never starves the behaviour
  // specs in CI. A guard around the capture keeps the assertions above enforced
  // instead of turning the whole test into a skip.
  if (!process.env.INFECTED_SHOT) return;

  // A base, then the clock to 23:00, so the capture is a night frame.
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
  await expect(page.getByTestId("pop")).toHaveText("4", { timeout: 15_000 });

  const spawned = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim;
    // Calibrate ticks -> game minutes from the simulation, never from a constant.
    sim.state.tick = 0;
    const h0 = sim.clock.hourFloat;
    sim.state.tick = 1000;
    const h1 = sim.clock.hourFloat;
    const ticksPerMinute = 1000 / Math.max(0.001, (h1 - h0) * 60);
    sim.state.tick = Math.max(0, Math.round((22.6 * 60 - h0 * 60) * ticksPerMinute));

    // Walker, runner and brute in one row, then a loose crowd behind them, so
    // the frame proves the scale difference and the tint difference at once.
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    const kinds: [string, number][] = [
      ["walker", -4],
      ["runner", 0],
      ["brute", 5],
    ];
    for (const [kind, dx] of kinds) sim.spawnInfected(kind, at.x + dx, at.y, -1);
    for (let i = 0; i < 9; i++) {
      const kind = i % 3 === 0 ? "runner" : "walker";
      sim.spawnInfected(kind, at.x - 8 + i * 2, at.y + 5 + (i % 2), -1);
    }
    g.step(1 / 60, 12);
    g.renderer.rts.jumpTo(at.x, at.y + 1);
    g.renderer.rts.goalDistance = 26;
    g.renderer.rts.distance = 26;
    return { infected: [...sim.infected()].length, hour: sim.clock.hourFloat };
  });
  console.log("INFECTED SHOT", JSON.stringify(spawned));
  await page.waitForTimeout(1_500);

  const after = await page.evaluate(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return { drawn: r.infectedParts[0].count, drawCalls: r.drawCalls };
  });
  console.log("INFECTED DRAWN", JSON.stringify(after));
  expect(after.drawn).toBe(spawned.infected);

  await page.screenshot({ path: "docs/art/infected.png" });
});
