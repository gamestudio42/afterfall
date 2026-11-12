import { expect, test } from "@playwright/test";
import { expectPopulation } from "./helpers";

type Win = { __afterfall: any };

/**
 * Captures the sky, the city beyond the map and the weather, with the camera
 * tilted low enough to see the horizon: a clear noon, rain, fog and a clear night.
 * Bloom and grade are forced on, as a GPU draws them.
 *
 * Opt-in: `ATMOS_SHOT=1 pnpm test:e2e tests/e2e/atmosphere-shot.spec.ts`; the captures
 * go to `docs/art/sky_clear.png`, `sky_rain.png`, `sky_fog.png`, `sky_night.png` and
 * `menu_backdrop.png` (the night without the HUD, packed by `tools/pack-menu-backdrop.ts`).
 */
test.skip(!process.env.ATMOS_SHOT, "set ATMOS_SHOT=1 to capture the sky and the weather");

test("captures the sky and the weather", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /shader|WebGL|THREE/i.test(m.text())) errors.push(m.text());
  });
  await page.goto("/?post=on");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();

  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const cx = g.sim.city.width / 2;
    const cy = g.sim.city.height / 2;
    let best = 0;
    let bd = Infinity;
    for (const b of g.sim.city.buildings) {
      const d = Math.hypot(b.entrance.x - cx, b.entrance.y - cy);
      if (d < bd) {
        bd = d;
        best = b.index;
      }
    }
    g.command({ type: "setBase", building: best });
  });
  await expectPopulation(page, "4");

  const frame = async (file: string, weather: string, hours: number) => {
    await page.evaluate(
      ([kind, h]) => {
        const g = (window as unknown as Win).__afterfall;
        g.sim.state.tick += (h as number) * 600;
        g.renderer.setWeather(kind, true);
        const rts = g.renderer.rts;
        rts.jumpTo(g.sim.city.width / 2, g.sim.city.height / 2);
        rts.goalPitch = rts.pitch = 0.26;
        rts.goalDistance = rts.distance = 150;
      },
      [weather, hours] as const,
    );
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `docs/art/${file}.png` });
  };

  // The game starts at 07:00; noon is five hours on, and 23:00 eleven more.
  await frame("sky_clear", "clear", 5);
  await frame("sky_rain", "rain", 0);
  await frame("sky_fog", "fog", 0);
  await frame("sky_night", "clear", 11);

  // The menu's backdrop: the same night without the HUD, from a little closer.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    (document.querySelector(".hud") as HTMLElement).style.visibility = "hidden";
    const rts = g.renderer.rts;
    rts.goalPitch = rts.pitch = 0.3;
    rts.goalDistance = rts.distance = 120;
  });
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: "docs/art/menu_backdrop.png" });

  const state = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall.renderer;
    return { weather: g.weather, post: g.postEnabled };
  });
  expect(state).toEqual({ weather: "clear", post: true });
  expect(errors, errors.join("\n")).toEqual([]);
});
