import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripDesktopAnalytics } from "./scripts/analytics.mjs";
import { smokeReady, type SmokeProbe } from "./src/smoke";

const here = path.dirname(fileURLToPath(import.meta.url));
const webIndex = readFileSync(path.join(here, "..", "web", "index.html"), "utf8");
const desktopMain = readFileSync(path.join(here, "src", "main.ts"), "utf8");

describe("desktop analytics", () => {
  it("keeps an explicit https GoatCounter tag on the web page and drops it for desktop", () => {
    expect(webIndex).toContain('src="https://gc.zgo.at/count.js"');
    expect(webIndex).toContain('data-goatcounter="https://gamestudio42.goatcounter.com/count"');
    expect(webIndex).not.toContain('src="//');

    const desktop = stripDesktopAnalytics(webIndex);
    expect(desktop).not.toContain("gc.zgo.at");
    expect(desktop).not.toContain("goatcounter");
    expect(desktop).toContain('src="/src/main.tsx"');
  });

  it("drops a built tag that is not on its own line and keeps the game module", () => {
    const built =
      '<script type="module" crossorigin src="./assets/index-abc.js"></script><script data-goatcounter="https://gamestudio42.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>';
    const desktop = stripDesktopAnalytics(built);
    expect(desktop).toBe('<script type="module" crossorigin src="./assets/index-abc.js"></script>');
  });

  it("leaves a page without analytics unchanged", () => {
    const html = '<html><body><div id="root"></div></body></html>\n';
    expect(stripDesktopAnalytics(html)).toBe(html);
  });

  it("keeps the desktop script policy limited to the app itself", () => {
    const csp = desktopMain.match(/"Content-Security-Policy":\s*\n\s*"([^"]+)"/)?.[1];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src 'self'(?:;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*zgo\.at/);
  });
});

describe("desktop smoke", () => {
  const probe: SmokeProbe = { storage: true, desktop: true, screen: "game", analytics: false };

  it("is ready only when the city is up, analytics is absent and the console is clean", () => {
    expect(smokeReady(true, probe, [])).toBe(true);
    expect(smokeReady(true, { ...probe, analytics: true }, [])).toBe(false);
    expect(smokeReady(true, { ...probe, analytics: undefined }, [])).toBe(false);
    expect(
      smokeReady(true, probe, ["Loading the script 'app://gc.zgo.at/count.js' violates the following Content Security Policy directive"]),
    ).toBe(false);
    expect(smokeReady(false, probe, [])).toBe(false);
    expect(smokeReady(true, { ...probe, screen: "menu" }, [])).toBe(false);
    expect(smokeReady(true, null, [])).toBe(false);
  });
});
