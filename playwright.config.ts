import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Use a preinstalled Chromium when one is provided (e.g. CI images).
const executablePath = process.env.PW_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const shared = {
  baseURL: "http://localhost:5173",
  viewport: { width: 1440, height: 900 },
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  projects: [
    {
      name: "chromium",
      use: {
        ...shared,
        browserName: "chromium",
        launchOptions: {
          executablePath,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            // Without these Chromium throttles requestAnimationFrame in a tab
            // that is not in the foreground: the simulation, the audio and the
            // effects stop, and every test that depends on frames turns flaky.
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...shared,
        browserName: "firefox",
        launchOptions: {
          firefoxUserPrefs: {
            "webgl.disabled": false,
            "webgl.force-enabled": true,
          },
        },
      },
    },
    { name: "webkit", use: { ...shared, browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm --filter @afterfall/web exec vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
