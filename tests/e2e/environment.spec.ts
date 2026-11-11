import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Win = { __afterfall: any };

test("urban surfaces and Refloreste vegetation load and render without shader errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text());
  });
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return r.vegetation?.group.visible && r.groundMats.roads.bumpMap && r.groundMats.blocks.bumpMap && r.decalMat.map;
  });
  const result = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    cancelAnimationFrame(g.raf);
    g.renderer.render(0);
    const r = g.renderer;
    return {
      fallback: r.cityGroup.getObjectByName("park-tree-fallback").visible,
      plants: r.vegetation.group.children.map((m: any) => ({ name: m.name, count: m.count, instanced: m.isInstancedMesh })),
      roughness: r.groundMats.roads.roughnessMap === r.groundMats.roads.bumpMap,
      atlas: [r.decalMat.map.image.width, r.decalMat.map.image.height],
    };
  });
  expect(result.fallback).toBe(false);
  expect(result.plants.length).toBeGreaterThanOrEqual(4);
  expect(result.plants.every((p: any) => p.instanced)).toBe(true);
  expect(result.plants.find((p: any) => p.name === "vegetation-manaca-leaves")?.count).toBeGreaterThan(0);
  expect(result.roughness).toBe(true);
  expect(result.atlas).toEqual([512, 384]);
  if (process.env.ENVIRONMENT_SHOT) {
    for (const [label, hour, distance, park] of [
      ["street-day", 10, 60, false],
      ["park-day", 10, 65, true],
      ["park-night", 22, 65, true],
    ] as const) {
      await page.evaluate(
        ({ hour, distance, park }) => {
          const g = (window as unknown as Win).__afterfall;
          const r = g.renderer;
          g.sim.state.tick = (hour * 60 - 7 * 60) * 10;
          const p = g.sim.city.parks.find((p: any) => p.trees.length > 6) ?? g.sim.city.parks[0];
          r.rts.jumpTo(park ? p.rect.x + p.rect.w / 2 : 150, park ? p.rect.y + p.rect.h / 2 : 204);
          r.rts.distance = r.rts.goalDistance = distance;
          r.rts.yaw = r.rts.goalYaw = 0.45;
          r.render(0.016);
        },
        { hour, distance, park },
      );
      await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
      const canvas = await page.evaluate(() => {
        const r = (window as unknown as Win).__afterfall.renderer;
        r.renderFrame();
        return r.canvas.toDataURL("image/png");
      });
      await writeFile(testInfo.outputPath(`${label}-scene.png`), Buffer.from(canvas.split(",")[1], "base64"));
    }
    console.log("ENVIRONMENT", JSON.stringify(result));
  }
  expect(errors).toEqual([]);
});

test("missing vegetation and decal assets keep a usable fallback", async ({ page }) => {
  await page.route("**/art/vegetation/pequi.glb", (route) => route.fulfill({ status: 404, body: "Missing asset fixture" }));
  await page.route("**/art/decals.png", (route) => route.fulfill({ status: 404, body: "Missing asset fixture" }));
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as unknown as Win).__afterfall.renderer.vegetation?.disposed);
  const state = await page.evaluate(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return {
      fallback: r.cityGroup.getObjectByName("park-tree-fallback").visible,
      partialModels: r.vegetation.group.children.length,
      decals: r.decalMat.opacity,
    };
  });
  expect(state).toEqual({ fallback: true, partialModels: 0, decals: 0 });
  await page.evaluate(() => (window as unknown as Win).__afterfall.command({ type: "setBase", building: 0 }));
  // The command drains on a simulation tick; match the main-loop test's allowance
  // for a loaded software-rendering runner, and still require all four founders.
  await expect(page.getByTestId("pop")).toHaveText("4", { timeout: 20_000 });
});
