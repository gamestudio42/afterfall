import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

interface Win {
  __afterfall: {
    sim: {
      city: { width: number; height: number; buildings: { index: number; entrance: { x: number; y: number } }[] };
      state: { buildings: unknown[] };
    };
    command: (cmd: unknown) => void;
  };
}

/**
 * Renders a frame for art review and measures the frame cost, so a look change
 * is argued with numbers instead of taste.
 *
 * Opt-in on purpose: measuring 120 frames of software rendering starves the
 * other worker, and when this ran on every CI pass it took the minimap test
 * down with it. Run it with `ART_SHOT=1 pnpm test:e2e tests/e2e/art-shot.spec.ts`.
 */
test.skip(!process.env.ART_SHOT, "set ART_SHOT=1 to measure the frame cost");

test("renders a frame and reports frame cost", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
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

  await page.evaluate((index) => {
    const g = (window as unknown as Win).__afterfall;
    g.command({ type: "setBase", building: index });
  }, hq);
  await expectPopulation(page, "4");
  await page.waitForTimeout(1_500);

  const stats = await page.evaluate(async () => {
    const frames: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      let n = 0;
      const step = (t: number) => {
        frames.push(t - last);
        last = t;
        if (++n >= 40) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = frames.reduce((s, v) => s + v, 0) / frames.length;
    return {
      meanMs: +mean.toFixed(2),
      fps: +(1000 / mean).toFixed(1),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      worstMs: +sorted[sorted.length - 1].toFixed(2),
    };
  });
  console.log("FRAME", JSON.stringify(stats));

  await page.screenshot({ path: "docs/art/frame.png" });
});
