import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type Win = { __afterfall: any };

test("characters are skinned on the GPU, equip weapons and freeze when paused", async ({ page }, testInfo) => {
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
  // Asset loading is real I/O and can take longer on a loaded software-WebGL CI runner.
  await page.waitForFunction(
    () => {
      const r = (window as unknown as Win).__afterfall.renderer;
      return r.unitParts.length > 0 && r.infectedParts.length > 0;
    },
    null,
    { timeout: 30_000 },
  );
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
    const skin = parts.find((m: any) => m.material.name === "skin");
    const batch = g.renderer.unitBatch;
    // Three people posed: three rows of bones, a 3×4 matrix per bone.
    const snapshot = (): number[] => Array.from(batch.bones.image.data.slice(0, 3 * batch.rig.bones * 12));
    const before = snapshot();
    for (let i = 0; i < 5; i++) g.renderer.render(0.1);
    const weights = g.renderer.motions.get(people[0].id).weights;
    return {
      before,
      after: snapshot(),
      // 0.12 m a 0.1 s tick is 1.2 m/s, a survivor's walk (decision 66): two adjacent walk keys.
      adjacent: weights.slice(0, 16).filter((w: number) => w > 0).length,
      // Every part reads its people's bones from the batch's rows.
      rows: parts.map((m: any) => Array.from(m.geometry.getAttribute("boneRow").array.slice(0, m.count))),
      morphs: parts.map((m: any) => Object.keys(m.geometry.morphAttributes).length),
      weapons: parts.filter((m: any) => ["crowbar", "pistol", "rifle"].includes(m.material.name)).map((m: any) => m.count),
      skin: Array.from(skin.instanceColor.array.slice(0, 9)),
      textureHeight: batch.bones.image.height,
      moving: before.some((v: number, i: number) => i % 12 === 3 && v !== 0),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.adjacent).toBe(2);
  expect(result.morphs.every((n: number) => n === 0)).toBe(true);
  expect(result.rows.find((r: number[]) => r.length === 3)).toEqual([0, 1, 2]);
  expect(result.moving).toBe(true);
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
    // Each material and its mirrored twin (decision 67) share the horde between them.
    const pairs = stress.counts.filter((_: number, i: number) => i % 2 === 0).map((n: number, i: number) => n + stress.counts[i * 2 + 1]);
    expect(pairs).toEqual([600, 600, 600, 600, 600, 600]);
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
          const w = window as unknown as { __x0?: Map<number, number> };
          w.__x0 ??= new Map([...g.sim.state.entities.values()].map((e: any) => [e.id, e.transform.x]));
          for (const e of g.sim.state.entities.values()) {
            if (label === "attack") (e.survivor ?? e.infected).cooldown = 1;
            e.transform.x = e.transform.px = w.__x0.get(e.id)! + (time - 1) * 0.6;
          }
          // Pose and place everyone at this moment without running the simulation or moving the art camera.
          const r = g.renderer;
          r.updateUnits(g.sim, time / 0.1 - g.sim.state.tick);
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
