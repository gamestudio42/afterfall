import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Win = { __afterfall: any };

test("characters blend on the GPU, equip weapons and freeze when paused", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /THREE|WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const r = (window as unknown as Win).__afterfall.renderer;
    return r.unitParts.length > 0 && r.infectedParts.length > 0;
  });
  const result = await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    cancelAnimationFrame(g.raf);
    const sim = g.sim;
    sim.state.entities.clear();
    const people = [0, 1, 2].map((i) => sim.spawnSurvivor(100 + i * 2, 100));
    ["crowbar", "pistol", "rifle"].forEach((weapon, i) => {
      people[i].survivor.weapon = weapon;
      people[i].survivor.ammo = 10;
    });
    ["walker", "runner", "brute"].forEach((kind, i) => sim.spawnInfected(kind, 100 + i * 2.5, 105, -1));
    g.renderer.render(0);
    for (let frame = 1; frame <= 10; frame++) {
      sim.state.tick = frame;
      for (const e of sim.state.entities.values()) {
        const t = e.transform;
        t.x += 0.12;
        t.px = t.x;
        t.py = t.y;
      }
      g.renderer.render(0.1);
    }
    const parts = g.renderer.unitParts;
    const cloth = parts.find((m: any) => m.material.name === "cloth");
    const skin = parts.find((m: any) => m.material.name === "skin");
    const snapshot = () => Array.from(cloth.morphTexture.image.data);
    const before = snapshot();
    for (let i = 0; i < 5; i++) g.renderer.render(0.1);
    return {
      before,
      after: snapshot(),
      adjacent: before.slice(9, 21).filter((w: any) => w > 0).length,
      weapons: parts.filter((m: any) => ["crowbar", "pistol", "rifle"].includes(m.material.name)).map((m: any) => m.count),
      skin: Array.from(skin.instanceColor.array.slice(0, 9)),
      textureHeight: cloth.morphTexture.image.height,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.adjacent).toBe(2);
  expect(result.weapons).toEqual([1, 1, 1]);
  expect(result.textureHeight).toBe(64);
  expect(result.skin.slice(0, 3)).not.toEqual(result.skin.slice(3, 6));

  if (process.env.CHARACTER_STRESS) {
    const stress = await page.evaluate(() => {
      const g = (window as unknown as Win).__afterfall;
      const sim = g.sim;
      for (const e of [...sim.infected()]) sim.state.entities.delete(e.id);
      for (let i = 0; i < 600; i++)
        sim.spawnInfected(["walker", "runner", "brute"][i % 3], 90 + (i % 30) * 1.5, 90 + Math.floor(i / 30) * 1.5, -1);
      g.renderer.rts.jumpTo(112, 104);
      g.renderer.rts.distance = g.renderer.rts.goalDistance = 70;
      g.renderer.render(0.1);
      const samples = [];
      for (let frame = 0; frame < 3; frame++) {
        sim.state.tick++;
        for (const e of sim.infected()) {
          e.transform.x += 0.1;
          e.transform.px = e.transform.x;
        }
        const start = performance.now();
        g.renderer.render(0.1);
        g.renderer.renderer.getContext().finish();
        samples.push(performance.now() - start);
      }
      return { counts: g.renderer.infectedParts.map((m: any) => m.count), samples, calls: g.renderer.drawCalls };
    });
    expect(stress.counts).toEqual([600, 600, 600, 600, 600, 600]);
    console.log("CHARACTER STRESS", JSON.stringify(stress));
  }

  // Optional art review uses the real batches and lighting, with scenery hidden
  // to expose feet, proportions and equipment rather than obstruct them with roofs.
  if (process.env.CHARACTER_SHOT) {
    const capture = async (name: string) => {
      const data = await page.evaluate(() => {
        const r = (window as unknown as Win).__afterfall.renderer;
        r.renderer.render(r.scene, r.rts.camera);
        return r.canvas.toDataURL("image/png");
      });
      await writeFile(testInfo.outputPath(name), Buffer.from(data.split(",")[1], "base64"));
    };
    await page.evaluate(() => {
      const g = (window as unknown as Win).__afterfall;
      const r = g.renderer;
      const visible = new Set([...r.unitParts, ...r.infectedParts]);
      for (const o of r.scene.children) if (!o.isLight && !visible.has(o)) o.visible = false;
      r.cityGroup.visible = true;
      r.scene.background.setHex(0x242d36);
      r.scene.fog = null;
      for (const e of g.sim.state.entities.values()) {
        e.transform.heading = Math.PI / 2;
        const motion = r.motions.get(e.id);
        if (motion) motion.heading = Math.PI / 2;
      }
      r.updateUnits(g.sim, g.sim.alpha);
      r.rts.camera.position.set(109, 6, 114);
      r.rts.camera.lookAt(103, 0.8, 102.3);
      r.renderer.render(r.scene, r.rts.camera);
    });
    await capture("characters.png");
    for (const [label, time] of [
      ["contact", 1.1],
      ["passing", 1.25],
      ["stride", 1.45],
      ["attack", 1.6],
      ["impact", 1.75],
    ] as const) {
      await page.evaluate(
        ({ time, label }) => {
          const g = (window as unknown as Win).__afterfall;
          for (const e of g.sim.state.entities.values()) {
            const motion = g.renderer.motions.get(e.id);
            if (label === "attack") (e.survivor ?? e.infected).cooldown = 1;
            motion.update(e, e.transform.x + (time - 1) * 0.6, e.transform.y, time);
          }
          // Place updated weights without running the simulation or changing the art camera.
          const r = g.renderer;
          for (const batch of [r.unitBatch, r.infectedBatch]) {
            for (const { mesh, sample } of batch.parts) {
              let at = 0;
              for (const e of g.sim.state.entities.values()) {
                if (!!e.infected !== batch.infected) continue;
                if (["crowbar", "pistol", "rifle"].includes(mesh.material.name) && mesh.material.name !== e.survivor.weapon) continue;
                sample.morphTargetInfluences = r.motions.get(e.id).weights;
                mesh.setMorphAt(at++, sample);
              }
            }
            batch.end();
          }
          r.renderer.render(r.scene, r.rts.camera);
        },
        { time, label },
      );
      await capture(`${label}.png`);
    }
    await testInfo.attach("Character silhouettes", { path: testInfo.outputPath("characters.png"), contentType: "image/png" });
  }
  expect(errors).toEqual([]);
});
