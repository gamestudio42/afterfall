import { expect, type Page } from "@playwright/test";

type Win = {
  __afterfall?: { sim?: { survivorCount: () => number; update: (dt: number, speed: number) => number } };
  __afterfallUi?: { getState: () => { frame: number; set: (patch: { frame: number }) => void } };
};

/**
 * The founding group is applied on the next simulation tick, and the counter
 * re-reads it only after a few rendered frames. On a loaded software renderer
 * those frames can land after the assertion has already given up, while the
 * clock is still 07:00. A paused frame drains commands without drawing, so do
 * that and publish one UI frame instead of waiting out the renderer.
 */
export async function expectPopulation(page: Page, count: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((expected) => {
          const w = window as unknown as Win;
          const sim = w.__afterfall?.sim;
          if (!sim) return "";
          if (String(sim.survivorCount()) !== expected) sim.update(0, 0);
          const now = String(sim.survivorCount());
          if (now === expected) {
            const ui = w.__afterfallUi?.getState();
            if (ui) ui.set({ frame: ui.frame + 1 });
          }
          return now;
        }, count),
      { timeout: 20_000 },
    )
    .toBe(count);
  await expect(page.getByTestId("pop")).toHaveText(count);
}
