import { expect, test, type Page } from "@playwright/test";

/* A trilha de audio e criada no primeiro gesto; o controller publica o resumo
   em window.__afterfallAudio() para diagnostico e para este teste. */
type Win = {
  __afterfall: any;
  __afterfallAudio?: () => {
    state: string;
    loaded: number;
    failed: number;
    total: number;
    played: Record<string, number>;
    dropped: Record<string, number>;
    volume: number;
    muted: boolean;
    ambience: string | null;
  };
};

async function startGame(page: Page) {
  await page.bringToFront();
  await page.goto("/");
  await page.getByTestId("new-game").click(); // primeiro gesto: libera o audio
  await page.getByTestId("seed").fill("4242");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("help")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("choose-base")).toBeVisible();
}

test("loads the sound kit and plays an effect the simulation emits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startGame(page);

  // Os 9 efeitos + as 2 camas de ambiencia passaram por fetch + decodeAudioData.
  await page.waitForFunction(() => (window as unknown as Win).__afterfallAudio?.().loaded === 11, null, {
    timeout: 20_000,
  });
  const loaded = await page.evaluate(() => (window as unknown as Win).__afterfallAudio!());
  expect(loaded.failed).toBe(0);
  expect(loaded.state).toBe("running");

  // An fx at the centre of the screen (where the player "listens") must become sound.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.sim.emitFx("shot", at.x, at.y);
  });
  await page.waitForFunction(() => ((window as unknown as Win).__afterfallAudio?.().played.shot ?? 0) >= 1, null, {
    timeout: 10_000,
  });

  // Um fx do outro lado do mapa nao toca (atenuacao por distancia).
  await page.evaluate(() => {
    const g = (window as unknown as Win).__afterfall;
    const at = g.renderer.groundPoint(0, 0) ?? { x: 0, y: 0 };
    g.sim.emitFx("melee", at.x + 40_000, at.y + 40_000);
  });
  await page.waitForTimeout(400);

  const stats = await page.evaluate(() => (window as unknown as Win).__afterfallAudio!());
  expect(stats.played.shot).toBeGreaterThanOrEqual(1);
  expect(stats.played.melee ?? 0).toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);

  // A ambiencia entra sozinha na primeira metade do dia.
  await page.waitForFunction(() => (window as unknown as Win).__afterfallAudio?.().ambience !== null, null, {
    timeout: 10_000,
  });
  const amb = await page.evaluate(() => (window as unknown as Win).__afterfallAudio!());
  expect(amb.ambience).toBe("day");

  // Mudo e volume pela HUD chegam ao diretor.
  await page.getByTestId("mute").click();
  await page.waitForFunction(() => (window as unknown as Win).__afterfallAudio?.().muted === true, null, {
    timeout: 5_000,
  });
  await page.getByTestId("volume").fill("30");
  await page.waitForFunction(() => Math.abs(((window as unknown as Win).__afterfallAudio?.().volume ?? 0) - 0.3) < 0.01, null, {
    timeout: 5_000,
  });
  expect(errors, errors.join("\n")).toEqual([]);
});
