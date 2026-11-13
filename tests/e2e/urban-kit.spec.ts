import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Win = { __afterfall: any };

test("the urban kit retains its palettes, roof detail and instancing in WebGL", async ({ page }, testInfo) => {
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
  // Asset loading is real I/O and can take longer on a loaded software-WebGL CI runner.
  await page.waitForFunction(
    () => {
      const r = (window as unknown as Win).__afterfall.renderer;
      return r.propScene && r.structuresReady && r.buildings.materials.roof.bumpMap && r.vegetation?.group.visible;
    },
    null,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    cancelAnimationFrame(g.raf);
    const r = g.renderer;
    r.render(0);
    const props = r.propScene.meshes.filter((m: any) => m.name.startsWith("prop-"));
    const structures = [...r.structureModels.values()].flatMap((m: any) => m.parts);
    const paint = props.find((m: any) => m.name === "prop-car-surface_paint");
    const colours = new Set();
    for (let i = 0; i < paint.count; i++) colours.add(Array.from(paint.instanceColor.array.slice(i * 3, i * 3 + 3)).join(","));
    return {
      props: props.length,
      structures: structures.length,
      packed: [...props, ...structures].every((m: any) => m.isInstancedMesh && m.material.vertexColors && m.geometry.getAttribute("color")),
      carColours: colours.size,
      roofLinear: r.buildings.materials.roof.bumpMap.colorSpace === "",
      roofRoughness: r.buildings.materials.roof.bumpMap === r.buildings.materials.roof.roughnessMap,
    };
  });
  expect(result.props).toBeGreaterThanOrEqual(14);
  expect(result.structures).toBe(20);
  expect(result.packed).toBe(true);
  expect(result.carColours).toBeGreaterThan(1);
  expect(result.roofLinear && result.roofRoughness).toBe(true);

  if (process.env.URBAN_PROFILE) {
    const profile = await page.evaluate(() => {
      const r = (window as unknown as Win).__afterfall.renderer;
      const gl = r.renderer.getContext();
      const samples: any[] = [];
      for (const mode of ["full", "props-hidden", "trim-hidden", "props-no-shadows"]) {
        const shadows = r.propScene.meshes.map((m: any) => m.castShadow);
        for (const m of r.propScene.meshes) {
          m.visible = mode !== "props-hidden";
          if (mode === "props-no-shadows") m.castShadow = false;
        }
        r.buildings.materials.trim.visible = mode !== "trim-hidden";
        r.renderFrame();
        gl.finish();
        const frames = [];
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          r.renderFrame();
          gl.finish();
          frames.push(performance.now() - start);
        }
        samples.push({ mode, frames, calls: r.renderer.info.render.calls, triangles: r.renderer.info.render.triangles });
        r.propScene.meshes.forEach((m: any, i: number) => {
          m.visible = true;
          m.castShadow = shadows[i];
        });
        r.buildings.materials.trim.visible = true;
      }
      return samples;
    });
    console.log("URBAN_PROFILE", JSON.stringify(profile));
  }

  if (process.env.URBAN_SHOT) {
    const capture = async (name: string) => {
      const data = await page.evaluate(() => {
        const r = (window as unknown as Win).__afterfall.renderer;
        r.renderFrame();
        return r.canvas.toDataURL("image/png");
      });
      await writeFile(testInfo.outputPath(`${name}.png`), Buffer.from(data.split(",")[1], "base64"));
    };
    for (const hour of [10, 22]) {
      await page.evaluate((hour) => {
        const g = (window as unknown as Win).__afterfall;
        const r = g.renderer;
        g.sim.state.tick = (hour * 60 - 7 * 60) * 10;
        r.rts.jumpTo(150, 204);
        r.rts.distance = r.rts.goalDistance = 60;
        r.rts.yaw = r.rts.goalYaw = 0.45;
        r.render(0.016);
      }, hour);
      await capture(`street-${hour}`);
    }
    await page.evaluate(() => {
      const g = (window as unknown as Win).__afterfall;
      const r = g.renderer;
      const b = g.sim.city.buildings.find(
        (b: any) => b.type === "apartment" && b.floors >= 2 && b.height < 14 && b.rect.w > 10 && b.rect.h > 10,
      );
      if (!b) throw new Error("Missing residential inspection building");
      g.sim.state.tick = (10 * 60 - 7 * 60) * 10;
      r.rts.jumpTo(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2);
      r.rts.distance = r.rts.goalDistance = 42;
      r.rts.pitch = r.rts.goalPitch = 0.72;
      r.rts.yaw = r.rts.goalYaw = 0.65;
      r.render(0.016);
    });
    await capture("facade-day");
    // Inspection fixtures: arrange the actual runtime meshes in a park, using
    // the game's materials, lighting and camera. These are not gameplay scenes.
    await page.evaluate(async (moduleUrl) => {
      const { loadProps, PROP_KINDS, ROOF_KINDS } = await import(moduleUrl);
      const r = (window as unknown as Win).__afterfall.renderer;
      const placements = new Map([...PROP_KINDS, ...ROOF_KINDS].map((name) => [name, [{ x: 0, z: 0, rot: 0, scale: 1 }]]));
      await loadProps("/", placements, (kit: any) => {
        r.inspectionKit = kit;
      });
      for (const name of [...PROP_KINDS, ...ROOF_KINDS]) {
        if (!r.inspectionKit.meshes.some((m: any) => m.name.startsWith(`prop-${name}-`)))
          throw new Error(`Missing inspection model: ${name}`);
      }
    }, `/@fs/${process.cwd()}/packages/renderer/src/props.ts`);
    for (const kind of ["street", "structures", "roof"] as const) {
      await page.evaluate((kind) => {
        const g = (window as unknown as Win).__afterfall;
        const r = g.renderer;
        for (const obj of [...r.scene.children]) if (obj.userData.inspectionFixture) r.scene.remove(obj);
        g.sim.state.tick = (10 * 60 - 7 * 60) * 10;
        const p = g.sim.city.parks[0].rect;
        const x = p.x + p.w / 2,
          z = p.y + p.h / 2;
        r.rts.jumpTo(x, z);
        r.rts.distance = r.rts.goalDistance = kind === "structures" ? 32 : 28;
        r.rts.pitch = r.rts.goalPitch = 0.66;
        r.rts.yaw = r.rts.goalYaw = 0.35;
        r.render(0.016);
        for (const obj of r.scene.children) if (!obj.isLight && obj !== r.cityGroup) obj.visible = false;
        r.vegetation.group.visible = false;
        const layout: [string, number, number, number][] =
          kind === "roof"
            ? [
                ["roof_tank", -4, -2, 0],
                ["roof_ac", 1, 3, 0],
                ["roof_stairs", 3, -2, 0],
                ["roof_antenna", -6, 3, 0],
                ["roof_vent", 5, 3, 0],
              ]
            : kind === "street"
              ? [
                  ["container", -6, -4, Math.PI / 2],
                  ["ambulance", 2, -3.5, Math.PI / 2],
                  ["car", -4, 3, 0.65],
                  ["dumpster", 1, 2.5, 0.4],
                  ["barrier", 4.5, 3, 0],
                  ["crates", 6, -1, 0],
                  ["sign", -8, 3, 0],
                  ["lamp", 7, -5, 0],
                ]
              : [
                  ["farm", -4.5, -1, 0],
                  ["tower", 4.5, -3, 0],
                  ["well", 4, 4, 0],
                  ["wall_junction", -5, 6, 0],
                  ["wall", -5, 4, Math.PI / 2],
                  ["wall", -3, 6, 0],
                  ["gate", -1, 6, 0],
                  ["wall_patch", 1, 6, 0],
                ];
        for (const [name, ox, oz, yaw] of layout) {
          const sources =
            kind === "structures"
              ? r.structureModels.get(name).parts
              : r.inspectionKit.meshes.filter((m: any) => m.name.startsWith(`prop-${name}-`));
          for (const source of sources) {
            const m = source.clone();
            m.visible = true;
            m.count = 1;
            m.userData.inspectionFixture = true;
            const matrix = m.matrix.clone().makeRotationY(yaw);
            matrix.setPosition(x + ox, 0, z + oz);
            m.setMatrixAt(0, matrix);
            m.instanceMatrix.needsUpdate = true;
            m.computeBoundingSphere();
            r.scene.add(m);
          }
        }
      }, kind);
      await capture(`kit-${kind}`);
    }
    console.log("URBAN_KIT", JSON.stringify(result));
  }
  expect(errors).toEqual([]);
});
