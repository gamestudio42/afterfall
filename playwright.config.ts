import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Use a preinstalled Chromium when one is provided (e.g. CI images).
const executablePath = process.env.PW_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const shared = {
  baseURL: "http://localhost:5273",
  viewport: { width: 1440, height: 900 },
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
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
  // Every context renders WebGL in software on a headless box: seven of them at
  // once starve each other and the failures look like product bugs (a timeout
  // waiting for a frame, a dev server that gets killed mid-run).
  workers: process.env.CI ? 2 : 3,
  webServer: {
    // Port 5273, not 5173: another project on this machine defaults to 5173 and
    // Playwright happily reuses whatever answers there, which means the suite
    // can spend a whole run testing somebody else's app and reporting on it.
    // `--strictPort` keeps that from degrading into a silent second server.
    command: "pnpm --filter @afterfall/web exec vite --port 5273 --strictPort",
    url: "http://localhost:5273",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
