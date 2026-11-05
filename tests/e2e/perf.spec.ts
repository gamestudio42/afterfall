import { expect, test } from "@playwright/test";

type Win = {
  __afterfall: {
    sim: { state: { entities: Map<number, unknown> }; survivorCount(): number };
    renderer: { drawCalls: number; rts: { jumpTo(x: number, z: number): void } };
    command(cmd: unknown): void;
    step(dt: number, times: number): void;
    cost: { simMs: number; renderMs: number; totalMs: number; frames: number };
  };
};

/**
 * Measures what a frame costs, split into simulation and render, on a real city
 * with a real squad. Decision 7 of the repository claims the simulation is "well
 * under 1 ms per frame"; this is the probe that keeps that claim honest after the
 * art pass made rendering much heavier.
 *
 * Opt-in: `PERF_PROBE=1 pnpm test:e2e tests/e2e/perf.spec.ts`.
 */
test.skip(!process.env.PERF_PROBE, "set PERF_PROBE=1 to measure the frame cost");

async function measure(page: import("@playwright/test").Page, label: string, frames: number) {
  const stats = await page.evaluate(
    ({ n }) => {
      const g = (window as unknown as Win).__afterfall;
      g.cost.simMs = g.cost.renderMs = g.cost.totalMs = g.cost.frames = 0;
      // Warm up, then measure: the first frames compile shaders and upload
      // textures, which would dominate a short sample.
      g.step(1 / 60, 30);
      g.cost.simMs = g.cost.renderMs = g.cost.totalMs = g.cost.frames = 0;
      g.step(1 / 60, n);
      const c = g.cost;
      return {
        frames: c.frames,
        sim: +(c.simMs / c.frames).toFixed(3),
        render: +(c.renderMs / c.frames).toFixed(3),
        total: +(c.totalMs / c.frames).toFixed(3),
        entities: g.sim.state.entities.size,
        survivors: g.sim.survivorCount(),
        drawCalls: g.renderer.drawCalls,
      };
    },
    { n: frames },
  );
  console.log(`PERF ${label}`, JSON.stringify(stats));
  return stats;
}

test("measures the cost of a frame", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  const start = await measure(page, "no-base", 60);

  const hq = await page.evaluate(() => {
    const sim = (window as unknown as Win).__afterfall.sim as unknown as {
      city: { width: number; height: number; buildings: { index: number; entrance: { x: number; y: number } }[] };
    };
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
  // The command needs frames to run, and the probe owns the frames: step them.
  const squad = await page.evaluate((index) => {
    const g = (window as unknown as Win).__afterfall;
    g.command({ type: "setBase", building: index });
    g.step(1 / 60, 40);
    return g.sim.survivorCount();
  }, hq);
  console.log("PERF squad", squad);
  expect(squad).toBeGreaterThan(0);

  const settled = await measure(page, "base", 120);

  // A night with a horde is the heaviest thing the game does, so the clock is
  // jumped to 23:00 and the loop is stepped until the infected are on the map.
  const nightSpawn = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const sim = g.sim as unknown as { state: { tick: number }; clock: { hourFloat: number }; infected(): unknown[] };
    // Calibrate ticks -> game minutes from the simulation, as the night capture does.
    sim.state.tick = 0;
    const h0 = sim.clock.hourFloat;
    sim.state.tick = 1000;
    const h1 = sim.clock.hourFloat;
    const ticksPerMinute = 1000 / Math.max(0.001, (h1 - h0) * 60);
    sim.state.tick = Math.max(0, Math.round((23 * 60 - h0 * 60) * ticksPerMinute));
    // Run the night forward until the wave is on the map.
    for (let i = 0; i < 400 && sim.infected().length === 0; i++) g.step(1 / 60, 1);
    return { infected: sim.infected().length, hour: sim.clock.hourFloat };
  });
  console.log("PERF horde", JSON.stringify(nightSpawn));
  const night = await measure(page, "night", 120);

  expect(settled.frames).toBeGreaterThan(0);
  expect(start.drawCalls).toBeGreaterThan(0);
  expect(night.sim).toBeLessThan(50);
});
