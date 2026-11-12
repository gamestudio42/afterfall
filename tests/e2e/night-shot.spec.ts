import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any };

/**
 * Captures the same corner of the city at dawn, dusk and night, so the lighting
 * pass can be judged across the day instead of one flattering frame.
 *
 * Opt-in: `NIGHT_SHOT=1 pnpm test:e2e tests/e2e/night-shot.spec.ts`.
 */
test.skip(!process.env.NIGHT_SHOT, "set NIGHT_SHOT=1 to capture the day cycle");

test("captures dawn, dusk and night", async ({ page }) => {
  test.setTimeout(180_000);
  // Captures show the game as a GPU draws it: bloom and grade forced on.
  await page.goto("/?post=on");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

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

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.sim.hqEntrance();
    g.renderer.rts.jumpTo(at.x, at.y + 6);
    g.renderer.rts.goalDistance = 90;
    g.renderer.rts.distance = 90;
  });
  await page.waitForTimeout(1_500);

  const shots: [string, number][] = [
    ["dawn", 7.0],
    ["dusk", 18.6],
    ["night", 22.5],
  ];
  for (const [name, hour] of shots) {
    const stats = await page.evaluate(async (h) => {
      const g = (window as unknown as Win).__afterfall;
      // Calibrate ticks -> game minutes from the simulation itself instead of
      // guessing the constant: two probe ticks give the rate.
      const before = g.sim.state.tick;
      g.sim.state.tick = 0;
      const h0 = g.sim.clock.hourFloat;
      g.sim.state.tick = 1000;
      const h1 = g.sim.clock.hourFloat;
      const ticksPerMinute = 1000 / Math.max(0.001, (h1 - h0) * 60);
      // The clock starts at START_MINUTE, not at midnight, so the offset has to
      // come out of the probe as well: tick 0 is `h0`, not 00:00.
      g.sim.state.tick = Math.max(0, Math.round((h * 60 - h0 * 60) * ticksPerMinute));
      void before;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const frames: number[] = [];
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let n = 0;
        const step = (t: number) => {
          frames.push(t - last);
          last = t;
          if (++n >= 24) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const mean = frames.reduce((s, v) => s + v, 0) / frames.length;
      return {
        hour: h,
        clock: g.sim.clock.hourFloat,
        meanMs: +mean.toFixed(1),
        calls: g.renderer.drawCalls,
      };
    }, hour);
    console.log("NIGHT", name, JSON.stringify(stats));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/art/night_${name}.png` });
  }
});
