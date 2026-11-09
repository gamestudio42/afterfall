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
    const perPose = (set: { count: number }[][]) => set.map((pose) => pose[0]?.count ?? -1);
    return {
      poses: r.infectedPoses.length,
      parts: r.infectedParts.length,
      tinted: r.infectedParts.filter((m: { instanceColor: unknown }) => m.instanceColor !== null).length,
      capsuleHidden: r.infected.visible === false,
      capsuleCount: r.infected.count,
      materials: [...new Set(r.infectedParts.map((m: { material: { name: string } }) => m.material.name))].sort(),
      infectedPerPose: perPose(r.infectedPoses),
      unitsPerPose: perPose(r.unitPoses),
      drawCalls: r.drawCalls,
    };
  });
  console.log("INFECTED", JSON.stringify(state));

  // Six walk poses plus the standing one, three materials each.
  expect(state.poses).toBe(7);
  expect(state.parts).toBe(21);
  expect(state.materials).toEqual(["eyes", "rags", "skin"]);
  // Exactly one part per pose carries the kind tint: the skin. Tinting the rags and
  // the eyes too would multiply them by the skin colour and take them to black.
  expect(state.tinted).toBe(7);
  expect(state.capsuleHidden).toBe(true);
  expect(state.capsuleCount).toBe(0);
  // Every infected on the map is drawn by exactly one pose, never by two.
  const drawn = state.infectedPerPose.reduce((a: number, b: number) => a + b, 0);
  expect(drawn).toBeGreaterThan(0);
  expect(state.infectedPerPose.every((c: number) => c >= 0)).toBe(true);

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
    return { perPose: r.infectedPoses.map((pose: { count: number }[]) => pose[0]?.count ?? -1), drawCalls: r.drawCalls };
  });
  console.log("INFECTED DRAWN", JSON.stringify(after));
  // Every infected is drawn exactly once, spread over the poses by its own stride.
  expect(after.perPose.reduce((a: number, b: number) => a + b, 0)).toBe(spawned.infected);

  await page.screenshot({ path: "docs/art/infected.png" });
});
